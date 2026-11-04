import type { Item, MemoComment, SyncOperationResult, TopicNode } from "@menote/shared";
import { localDb, getMeta, setMeta, type OutboxRow } from "../db/localDb";
import type { KeyWrap } from "@menote/shared";
import { bulkPutItems } from "../db/itemsRepo";
import { bulkPutMemoComments, deleteMemoComments } from "../db/memoCommentsRepo";
import { deleteOutboxRows, listPendingOutbox, markOutboxError, releaseParkedSettings, settleSettingResult } from "../db/outboxRepo";
import { notifyLocalChange } from "../lib/broadcast";
import { newId } from "../lib/hash";
import { applyPulledSettings } from "./appearanceSettingsService";
import { applyPulledAiSettings } from "./aiSettingsService";
import { applyPulledRaindropSettings } from "./raindropSettingsService";
import { applyPulledPropertyTemplates } from "./propertyTemplateService";
import { applyPulledTableViewSettings } from "./tableViewSettingsService";
import { applyPulledWorkspaceSettings } from "./workspaceSettingsService";
import { outboxUpsert } from "./contentShared";
import { recordSyncDiagnostic } from "./syncDiagnosticsService";

/**
 * 同步引擎（G6，按 G2 定稿 §3/§4/§8）：单轮 = 推送排水 + 拉取推进；
 * Web Locks 主锁（ifAvailable）保证多标签页仅一个同步者；游标持久化于 meta。
 * 断网/失败：可重试指数退避（1/2/4/8s…封顶 60s ±20%）；rejected 移入失败态不阻塞队列。
 */

export const SYNC_CURSOR_KEY = "syncCursor";
const PUSH_BATCH = 10;
const PULL_MAX_PAGES = 50;
const PULL_PAGE_LIMIT = 200;
const RETRY_CAP_MS = 60_000;

export type SyncPhase = "idle" | "syncing" | "error";
const statusListeners = new Set<() => void>();
let phase: SyncPhase = "idle";

function setPhase(next: SyncPhase): void {
  if (phase === next) return;
  phase = next;
  statusListeners.forEach((listener) => listener());
}

export function subscribeSyncStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function getSyncPhase(): SyncPhase {
  return phase;
}

export async function getDeviceId(): Promise<string> {
  const existing = await getMeta<string>("deviceId");
  if (existing) return existing;
  const deviceId = newId();
  await setMeta("deviceId", deviceId);
  return deviceId;
}

function backoffMs(retries: number): number {
  const base = Math.min(1000 * 2 ** retries, RETRY_CAP_MS);
  const jitter = base * 0.2;
  return Math.round(base - jitter + Math.random() * jitter * 2);
}

async function postPush(deviceId: string, operations: OutboxRow[]): Promise<{ results: SyncOperationResult[] | null; errorCode: string | null }> {
  try {
    const response = await fetch("/api/sync/push", {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, operations }),
    });
    if (!response.ok) return { results: null, errorCode: `http_${response.status}` };
    const body: unknown = await response.json();
    const results = (body as { results?: unknown }).results;
    return Array.isArray(results)
      ? { results: results as SyncOperationResult[], errorCode: null }
      : { results: null, errorCode: "invalid_response_shape" };
  } catch {
    return { results: null, errorCode: "network_or_parse_error" };
  }
}

/**
 * Note 正文冲突（G2 §5-2）：本地稿另存冲突副本，原条目等待拉取采纳服务端版本。
 * 副本必须一并入队上传：只落本地的话，一次全量重同步或换设备就会把用户仅存的那份正文清掉。
 * 加密条目同样留副本（连同密钥包装块）：否则被顶掉的编辑会被静默丢掉。
 */
async function saveConflictCopy(row: OutboxRow, deviceId: string): Promise<void> {
  const localItem = await localDb.items.get(row.entityId);
  const payloadItem = localItem ?? (row.payload as { item?: Item } | null)?.item;
  if (!payloadItem) return;
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const copy: Item = {
    ...payloadItem,
    id: newId(),
    title: `${payloadItem.title}（冲突副本 ${stamp} · ${deviceId.slice(0, 6)}）`,
    rev: 1, metaRev: 1, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null,
    // 记下与原条目的关联：人工裁决时要能回溯这份稿子顶掉了哪一篇（G2 §5-2）。
    conflictOf: row.entityId,
  };
  const wraps = await localDb.wraps.get(row.entityId);
  await localDb.transaction("rw", localDb.items, localDb.outbox, localDb.wraps, async () => {
    await localDb.items.put(copy);
    if (wraps?.wraps.length) await localDb.wraps.put({ itemId: copy.id, wraps: wraps.wraps });
    await localDb.outbox.add(outboxUpsert(copy, 0, 0, copy.contentHash));
  });
}

/**
 * 版本号与服务端对齐（只增不减）：本地已推进的版本不能被回退，
 * 否则待推操作的版本链（baseRev）会断，下一轮推送又撞同一条前置条件。
 */
async function alignItemVersionUp(entityId: string, rev: number, metaRev: number): Promise<void> {
  const local = await localDb.items.get(entityId);
  if (!local) return;
  if (local.rev >= rev && local.metaRev >= metaRev) return;
  await localDb.items.put({ ...local, rev: Math.max(local.rev, rev), metaRev: Math.max(local.metaRev, metaRev) });
}

/**
 * 冲突后把本地版本号落到服务端当前值：冲突副本已另存，本地正文等待拉取覆盖。
 * keepRev=true 用于元数据冲突——正文版本与元数据冲突无关，不能动（待推正文操作还指着它）。
 */
async function alignItemVersionToServer(entityId: string, rev: number, metaRev: number, keepRev: boolean): Promise<void> {
  const local = await localDb.items.get(entityId);
  if (!local) return;
  const nextRev = keepRev ? local.rev : rev;
  if (local.rev === nextRev && local.metaRev === metaRev) return;
  await localDb.items.put({ ...local, rev: nextRev, metaRev });
}

async function handleResult(row: OutboxRow, result: SyncOperationResult): Promise<void> {
  if (result.result === "applied") {
    if (row.entity === "item") await alignItemVersionUp(row.entityId, result.rev, result.metaRev);
    return deleteOutboxRows([row.seq!]);
  }
  if (row.entity === "setting") {
    // 设置行：本地 rev 对齐服务端防乐观漂移；服务端无记录（rev 0）的冲突重推一次，
    // 让已拨开的开关真正落库（否则 UI 显示已开启、推理仍 409）。
    if (result.result === "duplicate") return settleSettingResult(row, result.rev, false);
    if (result.result === "conflict") return settleSettingResult(row, result.detail.rev, result.detail.rev === 0);
    return markOutboxError(row.seq!, `rejected:${result.code}`, Number.MAX_SAFE_INTEGER);
  }
  if (result.result === "duplicate") {
    // 服务端已有更新版本（重放/过期 LWW）：本地对齐版本号，条目内容随拉取收敛。
    if (row.entity === "item") await alignItemVersionUp(row.entityId, result.rev, result.metaRev);
    return deleteOutboxRows([row.seq!]);
  }
  if (result.result === "rejected") {
    return markOutboxError(row.seq!, `rejected:${result.code}`, Number.MAX_SAFE_INTEGER);
  }
  // conflict：元数据冲突服务端胜（G2 §5-3），对齐版本号后落队，正文冲突由 drainOutbox 另存副本。
  if (row.entity === "item") await alignItemVersionToServer(row.entityId, result.detail.rev, result.detail.metaRev, true);
  return deleteOutboxRows([row.seq!]);
}

async function drainOutbox(userId: string, deviceId: string): Promise<void> {
  // 一轮同步内同一条目只留一份冲突副本（G2 §5-1：只保留最新本地稿一份）。
  const conflictedItems = new Set<string>();
  for (;;) {
    const pending = await listPendingOutbox(userId, PUSH_BATCH);
    if (pending.length === 0) return;
    // 加密条目：随操作携带本地包装块（G7）。
    for (const row of pending) {
      if (row.entity === "topic" && row.action === "upsert") {
        const stored = await localDb.topicWraps.get(row.entityId);
        if (stored?.wraps.length) row.wraps = stored.wraps;
      } else {
        const stored = await localDb.wraps.get(row.entityId);
        if (stored) row.wraps = stored.wraps;
      }
    }
    const pushStartedAt = Date.now();
    for (const row of pending) recordSyncDiagnostic(userId, {
      category: "push", event: "operation_queued_for_push", entity: row.entity, entityId: row.entityId,
      action: row.action, operationId: row.operationId, baseRev: row.baseRev, baseMetaRev: row.baseMetaRev,
      retryCount: row.retries, deviceId,
    });
    const response = await postPush(deviceId, pending);
    if (response.results === null) {
      // 网络/服务端不可用：整批指数退避。
      for (const row of pending) {
        recordSyncDiagnostic(userId, {
          category: "error", event: "push_request_failed", entity: row.entity, entityId: row.entityId,
          action: row.action, operationId: row.operationId, baseRev: row.baseRev,
          baseMetaRev: row.baseMetaRev, code: response.errorCode ?? "push_failed", durationMs: Date.now() - pushStartedAt, deviceId,
        });
        await markOutboxError(row.seq!, response.errorCode ?? "network", backoffMs(row.retries));
      }
      return;
    }
    for (const row of pending) {
      if (row.entity === "item" && conflictedItems.has(row.entityId)) continue;
      const result = response.results.find((entry) => entry.operationId === row.operationId);
      if (result) {
        const conflict = result.result === "conflict";
        recordSyncDiagnostic(userId, {
          category: conflict ? "conflict" : result.result === "rejected" ? "error" : "push",
          event: conflict ? "server_conflict" : `push_${result.result}`,
          entity: row.entity, entityId: row.entityId, action: row.action, operationId: row.operationId,
          baseRev: row.baseRev, baseMetaRev: row.baseMetaRev,
          serverRev: "detail" in result ? result.detail.rev : "rev" in result ? result.rev : undefined,
          serverMetaRev: "detail" in result ? result.detail.metaRev : "metaRev" in result ? result.metaRev : undefined,
          result: result.result, code: result.result === "rejected" ? result.code : undefined,
          durationMs: Date.now() - pushStartedAt, deviceId,
        });
      }
      if (result?.result === "conflict" && row.entity === "item" && row.contentHash !== undefined) {
        // 多个自动保存版本可能同时排队；保留一份最新本地稿并清掉该条目的旧快照，避免每条都造副本。
        await saveConflictCopy(row, deviceId);
        recordSyncDiagnostic(userId, {
          category: "conflict", event: "conflict_copy_created", entity: row.entity,
          entityId: row.entityId, operationId: row.operationId, baseRev: row.baseRev,
          baseMetaRev: row.baseMetaRev, serverRev: result.detail.rev, serverMetaRev: result.detail.metaRev, deviceId,
        });
        const entityRows = await localDb.outbox.where("entityId").equals(row.entityId).and((entry) => entry.userId === userId).toArray();
        await deleteOutboxRows(entityRows.map((entityRow) => entityRow.seq!).filter((seq) => seq !== undefined));
        // 版本号落到服务端当前值：否则本地停在旧版本号上，下次保存又撞同一条前置条件，冲突副本反复出现。
        await alignItemVersionToServer(row.entityId, result.detail.rev, result.detail.metaRev, false);
        conflictedItems.add(row.entityId);
      }
      else if (result) await handleResult(row, result);
      else {
        recordSyncDiagnostic(userId, {
          category: "error", event: "push_result_missing", entity: row.entity, entityId: row.entityId,
          operationId: row.operationId, baseRev: row.baseRev, baseMetaRev: row.baseMetaRev,
          code: "missing_operation_result", durationMs: Date.now() - pushStartedAt, deviceId,
        });
        await markOutboxError(row.seq!, "missing_result", backoffMs(row.retries));
      }
    }
    if (pending.length < PUSH_BATCH) {
      // 结果处理可能重排了设置操作（冲突重推），队列仍有到期行则继续排空，
      // 保证 flushSync 单轮内把开关推上服务端（AI 提交前依赖这一轮）。
      if ((await listPendingOutbox(userId, PUSH_BATCH)).length === 0) return;
      continue;
    }
  }
}

async function applyTombstone(entry: { entityId: string; entity: "item" | "topic" | "memo_comment" }): Promise<void> {
  if (entry.entity === "item") await localDb.items.delete(entry.entityId);
  else if (entry.entity === "topic") await localDb.topics.delete(entry.entityId);
  else await deleteMemoComments([entry.entityId]);
}

/** 本地未上传（outbox 有行）的条目在全量重同步时保留（G2 §4）。 */
async function pendingEntityIds(userId: string): Promise<Set<string>> {
  const rows = await localDb.outbox.where("userId").equals(userId).toArray();
  return new Set(rows.map((row) => row.entityId));
}

async function pullUpdates(userId: string): Promise<void> {
  // 本地仍有待推操作的条目不覆盖（G2 §4 同款保护）：拉取拿服务端版本回写会把还没上传的正文
  // 与版本号一起退回去，下一轮推送就带着过期版本号去撞前置条件——冲突副本反复出现的第二条来源。
  const keep = await pendingEntityIds(userId);
  for (let page = 0; page < PULL_MAX_PAGES; page += 1) {
    const cursor = (await getMeta<number>(SYNC_CURSOR_KEY)) ?? 0;
    const pullStartedAt = Date.now();
    const response = await fetch(`/api/sync/pull?cursor=${cursor}`, { cache: "no-store" });
    if (!response.ok) {
      recordSyncDiagnostic(userId, { category: "error", event: "pull_request_failed", cursor, code: `http_${response.status}`, durationMs: Date.now() - pullStartedAt });
      throw new Error(`pull_${response.status}`);
    }
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) throw new Error("pull_shape");
    const { items, topics, memoComments, tombstones, nextCursor, hasMore, fullResync } = body as {
      items?: Item[]; topics?: TopicNode[]; memoComments?: MemoComment[]; tombstones?: { id: string; entity: "item" | "topic" | "memo_comment" }[];
      settings?: import("@menote/shared").UserSetting[];
      nextCursor?: unknown; hasMore?: boolean; fullResync?: boolean;
    };
    recordSyncDiagnostic(userId, {
      category: "pull", event: fullResync ? "full_resync_page_received" : "pull_page_received", cursor,
      nextCursor: Number(nextCursor ?? cursor) || cursor,
      count: (items?.length ?? 0) + (topics?.length ?? 0) + (memoComments?.length ?? 0) + (tombstones?.length ?? 0),
      durationMs: Date.now() - pullStartedAt,
    });
    // 包装块随页落库（G7：加密条目他端解锁的依据）。
    for (const group of (body as { wraps?: Array<{ itemId: string; wraps: KeyWrap[] }> }).wraps ?? []) {
      await localDb.wraps.put({ itemId: group.itemId, wraps: group.wraps });
    }
    for (const group of (body as { topicWraps?: Array<{ topicId: string; wraps: KeyWrap[] }> }).topicWraps ?? []) {
      await localDb.topicWraps.put({ topicId: group.topicId, wraps: group.wraps });
    }
    if (fullResync) {
      const allItems = await localDb.items.toArray();
      await localDb.items.bulkDelete(allItems.filter((row) => row.userId === userId && !keep.has(row.id)).map((row) => row.id));
      const allTopics = await localDb.topics.toArray();
      await localDb.topics.bulkDelete(allTopics.filter((row) => row.userId === userId && !keep.has(row.id)).map((row) => row.id));
      const allComments = await localDb.memoComments.toArray();
      await deleteMemoComments(allComments.filter((row) => row.userId === userId && !keep.has(row.id)).map((row) => row.id));
    }
    // 落库顺序：先墓碑、再条目/主题（G2 §4）。待推条目跳过回写，等推送成功后由下一轮拉取收敛。
    for (const tombstone of tombstones ?? []) {
      await applyTombstone({ entityId: tombstone.id, entity: tombstone.entity });
    }
    const incoming = (items ?? []).filter((item) => !keep.has(item.id));
    if (incoming.length > 0) await bulkPutItems(incoming);
    if (memoComments && memoComments.length > 0) await bulkPutMemoComments(memoComments);
    for (const topic of topics ?? []) {
      await localDb.topics.put(topic);
    }
    await applyPulledSettings(userId, (body as { settings?: import("@menote/shared").UserSetting[] }).settings ?? []);
    await applyPulledWorkspaceSettings(userId, (body as { settings?: import("@menote/shared").UserSetting[] }).settings ?? []);
    await applyPulledAiSettings(userId, (body as { settings?: import("@menote/shared").UserSetting[] }).settings ?? []);
    await applyPulledRaindropSettings(userId, (body as { settings?: import("@menote/shared").UserSetting[] }).settings ?? []);
    await applyPulledPropertyTemplates(userId, (body as { settings?: import("@menote/shared").UserSetting[] }).settings ?? []);
    await applyPulledTableViewSettings(userId, (body as { settings?: import("@menote/shared").UserSetting[] }).settings ?? []);
    await setMeta(SYNC_CURSOR_KEY, Number(nextCursor ?? cursor) || cursor);
    if (!hasMore) return;
  }
}

/** 单轮同步；由调度器（主锁持有者）调用。 */
export async function runSyncCycle(userId: string): Promise<void> {
  const cycleStartedAt = Date.now();
  recordSyncDiagnostic(userId, { category: "cycle", event: "sync_cycle_started" });
  setPhase("syncing");
  try {
    const deviceId = await getDeviceId();
    await releaseParkedSettings(userId);
    await drainOutbox(userId, deviceId);
    await pullUpdates(userId);
    setPhase("idle");
    recordSyncDiagnostic(userId, { category: "cycle", event: "sync_cycle_completed", durationMs: Date.now() - cycleStartedAt });
    notifyLocalChange();
    void userId;
  } catch (error) {
    recordSyncDiagnostic(userId, {
      category: "error", event: "sync_cycle_failed",
      code: error instanceof Error ? error.message.slice(0, 100) : "unknown",
      durationMs: Date.now() - cycleStartedAt,
    });
    setPhase("error");
  }
}

/**
 * 等到同步锁后跑完一轮。开启 AI 或刚改完的笔记必须先推上服务端，
 * 否则推理请求会在服务端看到「未启用」或「条目不存在」。
 */
export async function flushSync(userId: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.locks) {
    await runSyncCycle(userId);
    return;
  }
  await navigator.locks.request("menote-sync", async () => {
    await runSyncCycle(userId);
  });
}

/** 主锁调度（G2 §8）：抢不到锁的标签页直接返回，由持锁者同步并广播刷新。 */
export async function requestSync(userId: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.locks) {
    await runSyncCycle(userId);
    return;
  }
  await navigator.locks.request("menote-sync", { ifAvailable: true }, async (lock) => {
    if (lock) await runSyncCycle(userId);
  });
}
