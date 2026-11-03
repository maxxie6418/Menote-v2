import type { Item, MemoComment, SyncOperationResult, TopicNode } from "@menote/shared";
import { localDb, getMeta, setMeta, type OutboxRow } from "../db/localDb";
import type { KeyWrap } from "@menote/shared";
import { bulkPutItems } from "../db/itemsRepo";
import { bulkPutMemoComments, deleteMemoComments } from "../db/memoCommentsRepo";
import { deleteOutboxRows, listPendingOutbox, markOutboxError } from "../db/outboxRepo";
import { notifyLocalChange } from "../lib/broadcast";
import { newId } from "../lib/hash";
import { applyPulledSettings } from "./appearanceSettingsService";
import { applyPulledAiSettings } from "./aiSettingsService";
import { applyPulledRaindropSettings } from "./raindropSettingsService";

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

async function postPush(deviceId: string, operations: OutboxRow[]): Promise<SyncOperationResult[] | null> {
  try {
    const response = await fetch("/api/sync/push", {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, operations }),
    });
    if (!response.ok) throw new Error(`http_${response.status}`);
    const body: unknown = await response.json();
    const results = (body as { results?: unknown }).results;
    return Array.isArray(results) ? (results as SyncOperationResult[]) : null;
  } catch {
    return null;
  }
}

/** Note 正文冲突（G2 §5-2）：本地稿另存冲突副本，原条目等待拉取采纳服务端版本。 */
async function saveConflictCopy(row: OutboxRow): Promise<void> {
  const localItem = await localDb.items.get(row.entityId);
  const payloadItem = localItem ?? (row.payload as { item?: Item } | null)?.item;
  if (!payloadItem || payloadItem.content.scope !== "plain") return;
  const copy: Item = {
    ...payloadItem,
    id: newId(),
    title: `${payloadItem.title}（冲突副本 ${new Date().toLocaleString()}）`,
    rev: 1, metaRev: 1, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null,
  };
  await localDb.items.put(copy);
}

async function handleResult(row: OutboxRow, result: SyncOperationResult): Promise<void> {
  if (result.result === "applied") return deleteOutboxRows([row.seq!]);
  if (result.result === "duplicate") {
    // 服务端已有更新版本（重放/过期 LWW）：本地对齐版本号，条目内容随拉取收敛。
    if (row.entity === "item") {
      const local = await localDb.items.get(row.entityId);
      if (local && (local.rev < result.rev || local.metaRev < result.metaRev)) {
        await localDb.items.put({ ...local, rev: Math.max(local.rev, result.rev), metaRev: Math.max(local.metaRev, result.metaRev) });
      }
    }
    return deleteOutboxRows([row.seq!]);
  }
  if (result.result === "rejected") {
    return markOutboxError(row.seq!, `rejected:${result.code}`, Number.MAX_SAFE_INTEGER);
  }
  // conflict：正文操作保存冲突副本后交由拉取收敛；元数据操作服务端胜，直接落队。
  if (row.entity === "item" && row.contentHash !== undefined) await saveConflictCopy(row);
  return deleteOutboxRows([row.seq!]);
}

async function drainOutbox(userId: string, deviceId: string): Promise<void> {
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
    const results = await postPush(deviceId, pending);
    if (results === null) {
      // 网络/服务端不可用：整批指数退避。
      for (const row of pending) await markOutboxError(row.seq!, "network", backoffMs(row.retries));
      return;
    }
    const conflictedItems = new Set<string>();
    for (const row of pending) {
      if (row.entity === "item" && conflictedItems.has(row.entityId)) continue;
      const result = results.find((entry) => entry.operationId === row.operationId);
      if (result?.result === "conflict" && row.entity === "item" && row.contentHash !== undefined) {
        // 多个自动保存版本可能同时排队；保留一份最新本地稿并清掉该条目的旧快照，避免每条都造副本。
        await saveConflictCopy(row);
        const entityRows = await localDb.outbox.where("entityId").equals(row.entityId).and((entry) => entry.userId === userId).toArray();
        await deleteOutboxRows(entityRows.map((entityRow) => entityRow.seq!).filter((seq) => seq !== undefined));
        conflictedItems.add(row.entityId);
      }
      else if (result) await handleResult(row, result);
      else await markOutboxError(row.seq!, "missing_result", backoffMs(row.retries));
    }
    if (pending.length < PUSH_BATCH) return;
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
  for (let page = 0; page < PULL_MAX_PAGES; page += 1) {
    const cursor = (await getMeta<number>(SYNC_CURSOR_KEY)) ?? 0;
    const response = await fetch(`/api/sync/pull?cursor=${cursor}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`pull_${response.status}`);
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) throw new Error("pull_shape");
    const { items, topics, memoComments, tombstones, nextCursor, hasMore, fullResync } = body as {
      items?: Item[]; topics?: TopicNode[]; memoComments?: MemoComment[]; tombstones?: { id: string; entity: "item" | "topic" | "memo_comment" }[];
      settings?: import("@menote/shared").UserSetting[];
      nextCursor?: unknown; hasMore?: boolean; fullResync?: boolean;
    };
    // 包装块随页落库（G7：加密条目他端解锁的依据）。
    for (const group of (body as { wraps?: Array<{ itemId: string; wraps: KeyWrap[] }> }).wraps ?? []) {
      await localDb.wraps.put({ itemId: group.itemId, wraps: group.wraps });
    }
    for (const group of (body as { topicWraps?: Array<{ topicId: string; wraps: KeyWrap[] }> }).topicWraps ?? []) {
      await localDb.topicWraps.put({ topicId: group.topicId, wraps: group.wraps });
    }
    if (fullResync) {
      const keep = await pendingEntityIds(userId);
      const allItems = await localDb.items.toArray();
      await localDb.items.bulkDelete(allItems.filter((row) => row.userId === userId && !keep.has(row.id)).map((row) => row.id));
      const allTopics = await localDb.topics.toArray();
      await localDb.topics.bulkDelete(allTopics.filter((row) => row.userId === userId && !keep.has(row.id)).map((row) => row.id));
      const allComments = await localDb.memoComments.toArray();
      await deleteMemoComments(allComments.filter((row) => row.userId === userId && !keep.has(row.id)).map((row) => row.id));
    }
    // 落库顺序：先墓碑、再条目/主题（G2 §4）。
    for (const tombstone of tombstones ?? []) {
      await applyTombstone({ entityId: tombstone.id, entity: tombstone.entity });
    }
    if (items && items.length > 0) await bulkPutItems(items);
    if (memoComments && memoComments.length > 0) await bulkPutMemoComments(memoComments);
    for (const topic of topics ?? []) {
      await localDb.topics.put(topic);
    }
    await applyPulledSettings(userId, (body as { settings?: import("@menote/shared").UserSetting[] }).settings ?? []);
    await applyPulledAiSettings(userId, (body as { settings?: import("@menote/shared").UserSetting[] }).settings ?? []);
    await applyPulledRaindropSettings(userId, (body as { settings?: import("@menote/shared").UserSetting[] }).settings ?? []);
    await setMeta(SYNC_CURSOR_KEY, Number(nextCursor ?? cursor) || cursor);
    if (!hasMore) return;
  }
}

/** 单轮同步；由调度器（主锁持有者）调用。 */
export async function runSyncCycle(userId: string): Promise<void> {
  setPhase("syncing");
  try {
    const deviceId = await getDeviceId();
    await drainOutbox(userId, deviceId);
    await pullUpdates(userId);
    setPhase("idle");
    notifyLocalChange();
    void userId;
  } catch {
    setPhase("error");
  }
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
