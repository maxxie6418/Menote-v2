import {
  AI_SETTING_KEY, RAINDROP_SETTING_KEY, normalizeAiSettings, normalizeRaindropSettings,
  type Item, type TopicNode, type UserSetting,
} from "@menote/shared";
import type { MemoComment } from "@menote/shared";
import type { OutboxOperation, SyncConflictDetail, SyncOperationResult, SyncPage } from "@menote/shared";
import { ensureAttachmentRow, setAttachmentRefs } from "../db/attachments";
import { readMemoCommentState, readMemoOwnerState, upsertMemoComment } from "../db/memoComments";
import { putItemWraps, putTopicWraps, readItemWrapGroups, readTopicWrapGroups } from "../db/keyWraps";
import { purgeDeletedItems } from "../db/trash";
import {
  appendSyncLog, countItemReferences, deleteSyncOperation, markItemDeleted, purgeSyncOperations, readAllItemsPage, readAllTopics,
  readItemAttachmentHashes, readItems, readItemState, readLogPage, readSettings, readSyncOperation,
  readTopics, readMemoComments, readAllMemoComments, recordSyncOperation, toTombstone, updateItemContent, updateItemMeta, upsertItemRow, upsertTopicRow,
  readSettingState, writeSetting,
} from "../db/sync";

/**
 * 同步引擎服务端编排（G6，按 G2 定稿：管理线计划「专项设计 — 同步契约与边界」）。
 * 逐操作独立 D1 batch 事务；幂等 (user_id, operation_id)；冲突不回滚批内其他操作。
 * 拉取分页（G2 §4 游标 = sync_log.seq）与回收站永久清除（G8）同在本层编排。
 * SQL 一律在 db 层（db/sync.ts、db/attachments.ts、db/trash.ts、db/keyWraps.ts）。
 */

export interface ApplyContext {
  db: D1Database;
  userId: string;
  deviceId: string;
  now: number;
}

class SyncRejected extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function conflictResult(operationId: string, state: { rev: number; metaRev: number; contentHash: string }): SyncOperationResult {
  const detail: SyncConflictDetail = { rev: state.rev, metaRev: state.metaRev, contentHash: state.contentHash };
  return { operationId, result: "conflict", detail };
}

/** 附件引用对齐：以服务端 items 表重算涉及哈希的引用计数（正文哈希列表为基准，FR-SYNC-7）。 */
async function realignAttachmentRefs(ctx: ApplyContext, hashes: string[]): Promise<void> {
  for (const sha256 of new Set(hashes)) {
    if (!/^[0-9a-f]{64}$/.test(sha256)) continue;
    await ensureAttachmentRow(ctx.db, ctx.userId, sha256);
    await setAttachmentRefs(ctx.db, ctx.userId, sha256, await countItemReferences(ctx.db, ctx.userId, sha256), ctx.now);
  }
}

/**
 * 条目 upsert（G2 §1 版本通道 / §5 冲突裁决）：
 * 正文操作（操作层带 contentHash）与元数据操作各走各的版本通道——
 * 正文写只推进 rev、只改正文列；元数据写只推进 meta_rev、只改元数据列。
 * 版本前置条件只看对应通道：同端连续保存、改名后接着改正文都不会被误判成冲突；
 * 真冲突（正文哈希不同且正文版本前置不成立）才返回 409 detail（G2 §5-2）。
 */
async function applyItemUpsert(ctx: ApplyContext, operation: OutboxOperation): Promise<SyncOperationResult> {
  const item = (operation.payload as { item?: Item } | null)?.item;
  // 载荷中的 userId 一律忽略：归属以会话用户为准（FR-USR-3，服务端不信任客户端标识）。
  if (!item || item.id !== operation.entityId) throw new SyncRejected("invalid_payload");
  const current = await readItemState(ctx.db, ctx.userId, item.id);
  // 正文操作必带 contentHash（G2 §3 推送协议）；缺省即元数据操作。
  const contentOp = operation.contentHash !== undefined;
  if (current && contentOp) {
    // §5-1 正文一致收敛：版本落后也不算冲突，不生成冲突副本。
    if (item.contentHash === current.contentHash) {
      return { operationId: operation.operationId, result: "duplicate", rev: current.rev, metaRev: current.metaRev, contentHash: current.contentHash };
    }
    // §5-4 Memo 字段级 LWW：以服务端接收时序为准，不产生冲突副本。
    if (item.type === "memo" && item.updatedAt <= current.updatedAt) {
      return { operationId: operation.operationId, result: "duplicate", rev: current.rev, metaRev: current.metaRev, contentHash: current.contentHash };
    }
    // §5-2 Note 正文真冲突：正文哈希不同且正文版本前置不成立。
    if (item.type !== "memo" && current.rev !== operation.baseRev) {
      await recordConflict(ctx, operation, current);
      return conflictResult(operation.operationId, current);
    }
  }
  if (current && !contentOp) {
    // §5-3 元数据冲突：服务端胜出、不生成副本；客户端按 detail 重拉该实体回填 meta_rev。
    if (current.metaRev !== operation.baseMetaRev) {
      await recordConflict(ctx, operation, current);
      return conflictResult(operation.operationId, current);
    }
  }
  // 版本推进：正文写 rev+1 且 meta_rev 不动；元数据写 meta_rev+1 且 rev 不动（G2 §1）。
  const rev = current ? (contentOp ? Math.max(item.rev, current.rev + 1) : current.rev) : Math.max(item.rev, 1);
  const metaRev = current
    ? (contentOp ? Math.max(item.metaRev, current.metaRev) : Math.max(item.metaRev, current.metaRev + 1))
    : Math.max(item.metaRev, 1);
  const previousRefs = current ? (() => {
    try { return JSON.parse(current.attachmentHashesJson) as string[]; } catch { return []; }
  })() : [];
  // 客户端的元数据版本落后（他端改过元数据）时，正文照落、元数据保持服务端值（G2 §5-3 服务端胜出）。
  const metadataStale = current ? operation.baseMetaRev !== current.metaRev : false;
  if (current && !contentOp) {
    // 元数据写只落元数据列：正文与正文版本号保持服务端原值（避免把尚未上传的正文提前写进服务端）。
    await updateItemMeta(ctx.db, ctx.userId, ctx.deviceId, item, metaRev);
  } else if (current && metadataStale) {
    // 正文写 + 元数据落后：窄写正文列，不连带覆盖服务端更新的标题/标签/归属。
    await updateItemContent(ctx.db, ctx.userId, ctx.deviceId, item, rev);
  } else {
    await upsertItemRow(ctx.db, ctx.userId, ctx.deviceId, item, rev, metaRev);
  }
  if (operation.wraps && operation.wraps.length > 0) {
    await putItemWraps(ctx.db, ctx.userId, item.id, operation.wraps, ctx.now);
  }
  await appendSyncLog(ctx.db, ctx.userId, "item", item.id, "upsert", rev, metaRev, ctx.now);
  await recordSyncOperation(ctx.db, ctx.userId, operation.operationId, "item", item.id, "applied", rev, metaRev, item.contentHash, ctx.now);
  // 引用对齐覆盖旧+新引用集合：移除引用后计数同样要下降（FR-SYNC-7）。
  await realignAttachmentRefs(ctx, [...previousRefs, ...item.attachmentHashes]);
  return { operationId: operation.operationId, result: "applied", rev, metaRev };
}

/**
 * 冲突落账：记幂等结果并补一条 sync_log。
 * 补日志是为了让拉取把服务端当前版本送达客户端（G2 §4）——
 * 否则冲突后客户端停留在旧版本号上，下次保存又撞同一条前置条件，冲突副本会反复出现。
 */
async function recordConflict(
  ctx: ApplyContext, operation: OutboxOperation, current: { rev: number; metaRev: number; contentHash: string },
): Promise<void> {
  await recordSyncOperation(ctx.db, ctx.userId, operation.operationId, "item", operation.entityId, "conflict", current.rev, current.metaRev, current.contentHash, ctx.now);
  await appendSyncLog(ctx.db, ctx.userId, "item", operation.entityId, "upsert", current.rev, current.metaRev, ctx.now);
}

/** 软删：删除不推 rev（与客户端语义一致）；并发编辑胜由后续 upsert 复活（G2 §5-5）。 */
async function applyItemDelete(ctx: ApplyContext, operation: OutboxOperation): Promise<SyncOperationResult> {
  const current = await readItemState(ctx.db, ctx.userId, operation.entityId);
  if (!current) throw new SyncRejected("entity_missing");
  // 前置条件只看正文版本 rev：元数据版本与删除无关，不该让一次改名把删除挡成冲突。
  if (current.rev !== operation.baseRev) {
    await recordSyncOperation(ctx.db, ctx.userId, operation.operationId, "item", operation.entityId, "conflict", current.rev, current.metaRev, current.contentHash, ctx.now);
    await appendSyncLog(ctx.db, ctx.userId, "item", operation.entityId, "upsert", current.rev, current.metaRev, ctx.now);
    return conflictResult(operation.operationId, current);
  }
  const deletedAt = (operation.payload as { deletedAt?: number } | null)?.deletedAt ?? ctx.now;
  await markItemDeleted(ctx.db, ctx.userId, ctx.deviceId, operation.entityId, deletedAt);
  await appendSyncLog(ctx.db, ctx.userId, "item", operation.entityId, "delete", current.rev, current.metaRev, ctx.now);
  await recordSyncOperation(ctx.db, ctx.userId, operation.operationId, "item", operation.entityId, "applied", current.rev, current.metaRev, current.contentHash, ctx.now);
  await realignAttachmentRefs(ctx, await readItemAttachmentHashes(ctx.db, ctx.userId, operation.entityId));
  return { operationId: operation.operationId, result: "applied", rev: current.rev, metaRev: current.metaRev };
}

async function applyTopic(ctx: ApplyContext, operation: OutboxOperation): Promise<SyncOperationResult> {
  const topic = (operation.payload as { topic?: TopicNode } | null)?.topic;
  if (!topic || topic.id !== operation.entityId) throw new SyncRejected("invalid_payload");
  const deletedAt = operation.action === "delete" ? topic.deletedAt ?? ctx.now : topic.deletedAt;
  await upsertTopicRow(ctx.db, ctx.userId, topic, operation.action === "delete" ? deletedAt : topic.deletedAt);
  if (operation.wraps && operation.wraps.length > 0 && operation.action === "upsert") {
    await putTopicWraps(ctx.db, ctx.userId, topic.id, operation.wraps, ctx.now);
  }
  await appendSyncLog(ctx.db, ctx.userId, "topic", topic.id, operation.action, 0, 0, ctx.now);
  await recordSyncOperation(ctx.db, ctx.userId, operation.operationId, "topic", topic.id, "applied", 0, 0, null, ctx.now);
  void deletedAt;
  return { operationId: operation.operationId, result: "applied", rev: 0, metaRev: 0 };
}

async function applyMemoComment(ctx: ApplyContext, operation: OutboxOperation): Promise<SyncOperationResult> {
  const incoming = (operation.payload as { comment?: MemoComment } | null)?.comment;
  if (!incoming || incoming.id !== operation.entityId || !incoming.memoId || typeof incoming.content !== "string") {
    throw new SyncRejected("invalid_payload");
  }
  const owner = await readMemoOwnerState(ctx.db, ctx.userId, incoming.memoId);
  if (!owner || owner.type !== "memo" || owner.deleted_at !== null) throw new SyncRejected("memo_unavailable");
  const current = await readMemoCommentState(ctx.db, ctx.userId, incoming.id);
  if (operation.action === "delete") {
    if (!current) throw new SyncRejected("entity_missing");
    if (current.deleted_at !== null) return { operationId: operation.operationId, result: "duplicate", rev: current.rev, metaRev: 0, contentHash: null };
    if (current.rev !== operation.baseRev) {
      return { operationId: operation.operationId, result: "conflict", detail: { rev: current.rev, metaRev: 0, contentHash: null } };
    }
    const deletedAt = incoming.deletedAt ?? ctx.now;
    await upsertMemoComment(ctx.db, { ...incoming, userId: ctx.userId, rev: current.rev + 1, updatedAt: deletedAt, deletedAt });
    await appendSyncLog(ctx.db, ctx.userId, "memo_comment", incoming.id, "delete", current.rev + 1, 0, ctx.now);
    await recordSyncOperation(ctx.db, ctx.userId, operation.operationId, "memo_comment", incoming.id, "applied", current.rev + 1, 0, null, ctx.now);
    return { operationId: operation.operationId, result: "applied", rev: current.rev + 1, metaRev: 0 };
  }
  if (current && (current.rev > incoming.rev || (current.rev === incoming.rev && current.updated_at >= incoming.updatedAt))) {
    return { operationId: operation.operationId, result: "duplicate", rev: current.rev, metaRev: 0, contentHash: null };
  }
  const comment = { ...incoming, userId: ctx.userId, rev: Math.max(incoming.rev, (current?.rev ?? 0) + 1), deletedAt: null };
  await upsertMemoComment(ctx.db, comment);
  await appendSyncLog(ctx.db, ctx.userId, "memo_comment", comment.id, "upsert", comment.rev, 0, ctx.now);
  await recordSyncOperation(ctx.db, ctx.userId, operation.operationId, "memo_comment", comment.id, "applied", comment.rev, 0, null, ctx.now);
  return { operationId: operation.operationId, result: "applied", rev: comment.rev, metaRev: 0 };
}

const ORDINARY_SETTING_KEYS = new Set(["appearance", AI_SETTING_KEY, RAINDROP_SETTING_KEY]);

function ordinarySettingValue(key: string, value: unknown): unknown {
  if (key === AI_SETTING_KEY) return normalizeAiSettings(value);
  if (key === RAINDROP_SETTING_KEY) return normalizeRaindropSettings(value);
  return value;
}

async function applySetting(ctx: ApplyContext, operation: OutboxOperation): Promise<SyncOperationResult> {
  const incoming = (operation.payload as { setting?: UserSetting } | null)?.setting;
  if (!incoming || incoming.key !== operation.entityId || !ORDINARY_SETTING_KEYS.has(incoming.key) || incoming.sensitivity !== "ordinary" ||
      !Number.isSafeInteger(operation.baseRev) || operation.baseRev < 0) throw new SyncRejected("invalid_payload");
  const current = await readSettingState(ctx.db, ctx.userId, incoming.key);
  if ((current?.rev ?? 0) !== operation.baseRev) {
    const rev = current?.rev ?? 0;
    await recordSyncOperation(ctx.db, ctx.userId, operation.operationId, "setting", incoming.key, "conflict", rev, 0, null, ctx.now);
    return { operationId: operation.operationId, result: "conflict", detail: { rev, metaRev: 0, contentHash: null } };
  }
  const next: UserSetting = {
    userId: ctx.userId, key: incoming.key, sensitivity: "ordinary",
    value: ordinarySettingValue(incoming.key, incoming.value),
    rev: operation.baseRev + 1, updatedAt: ctx.now,
  };
  const changed = await writeSetting(ctx.db, next, operation.baseRev, operation.operationId, ctx.now);
  if (changed !== 1) {
    const latest = await readSettingState(ctx.db, ctx.userId, incoming.key);
    const rev = latest?.rev ?? 0;
    await recordSyncOperation(ctx.db, ctx.userId, operation.operationId, "setting", incoming.key, "conflict", rev, 0, null, ctx.now);
    return { operationId: operation.operationId, result: "conflict", detail: { rev, metaRev: 0, contentHash: null } };
  }
  return { operationId: operation.operationId, result: "applied", rev: next.rev, metaRev: 0 };
}

/** 逐操作应用入口；单操作任何确定失败不影响其余操作（G2 §3）。 */
export async function applyOperation(ctx: ApplyContext, operation: OutboxOperation): Promise<SyncOperationResult> {
  const previous = await readSyncOperation(ctx.db, ctx.userId, operation.operationId);
  if (previous) {
    if (previous.result === "rejected") {
      // rejected 不是已应用：旧服务端拒过的操作（如早前被拒的 ai 设置）在规则放行后
      // 同 operationId 重推须重新判定，删记录后落入下方正常流程（G2 §6 幂等只覆盖已应用）。
      await deleteSyncOperation(ctx.db, ctx.userId, operation.operationId);
    } else if (previous.result === "conflict") {
      return { operationId: operation.operationId, result: "conflict", detail: { rev: previous.rev, metaRev: previous.metaRev, contentHash: previous.contentHash } };
    } else {
      return { operationId: operation.operationId, result: "duplicate", rev: previous.rev, metaRev: previous.metaRev, contentHash: previous.contentHash };
    }
  }
  try {
    if (operation.entity === "item") {
      return operation.action === "delete" ? await applyItemDelete(ctx, operation) : await applyItemUpsert(ctx, operation);
    }
    if (operation.entity === "topic") {
      return await applyTopic(ctx, operation);
    }
    if (operation.entity === "memo_comment") return await applyMemoComment(ctx, operation);
    if (operation.entity === "setting") return await applySetting(ctx, operation);
    return { operationId: operation.operationId, result: "rejected", code: "unsupported_entity" };
  } catch (error) {
    if (error instanceof SyncRejected) {
      await recordSyncOperation(ctx.db, ctx.userId, operation.operationId, operation.entity, operation.entityId, "rejected", 0, 0, null, ctx.now);
      throw error;
    }
    throw error;
  }
}

/** 已知操作表清理（保留期 90 天随 G10 cleanup 执行；此处供测试与手动调用）。 */
export async function purgeOperationsBefore(ctx: ApplyContext, before: number): Promise<void> {
  await purgeSyncOperations(ctx.db, ctx.userId, before);
}

/** 批量推送入口：逐操作独立事务，单操作确定失败不影响其余（G2 §3），失败映射为 rejected 结果。 */
export async function applyOperations(ctx: ApplyContext, operations: OutboxOperation[]): Promise<SyncOperationResult[]> {
  const results: SyncOperationResult[] = [];
  for (const operation of operations) {
    try {
      results.push(await applyOperation(ctx, operation));
    } catch (error) {
      const code = error instanceof Error && error.message.startsWith("invalid") ? "invalid_payload" : "entity_missing";
      results.push({ operationId: operation.operationId, result: "rejected", code });
    }
  }
  return results;
}

/** 拉取分页上限（G2 定稿 200/页）。 */
const PULL_PAGE_LIMIT = 200;

/** 拉取一页（G2 §4）：游标早于保留窗口 → 全量重同步（fullResync，cursor=0 同样适用）；
 *  否则按 sync_log.seq 增量返回条目与墓碑；加密条目附带包装块（G7）。 */
export async function buildSyncPage(db: D1Database, userId: string, cursor: number, now: number): Promise<SyncPage> {
  const page = await readLogPage(db, userId, cursor, PULL_PAGE_LIMIT);
  // 游标早于保留窗口 → 全量重同步（G2 §4）；cursor=0 同样适用（有日志被清理即缺失状态）。
  const oldestSeq = page.oldestSeq;
  if (oldestSeq !== null && oldestSeq > cursor + 1) {
    const items = await readAllItemsPage(db, userId, 0, PULL_PAGE_LIMIT);
    const topics = await readAllTopics(db, userId);
    const encryptedIds = items.filter((item) => item.content.scope !== "plain").map((item) => item.id);
    const wraps = await readItemWrapGroups(db, userId, encryptedIds);
    const topicWraps = await readTopicWrapGroups(db, userId, topics.filter((topic) => topic.isEncSpace).map((topic) => topic.id));
    return {
      items, topics, tombstones: [], wraps, topicWraps, settings: await readSettings(db, userId),
      memoComments: await readAllMemoComments(db, userId),
      nextCursor: String(oldestSeq - 1), hasMore: items.length === PULL_PAGE_LIMIT, fullResync: true,
    };
  }

  // Retained soft-delete rows return as items; only physically removed rows
  // need tombstones. Never send both for the same item/topic in one page.
  const itemIds = [...new Set(page.entries.filter((entry) => entry.entity === "item").map((entry) => entry.entityId))];
  const topicIds = [...new Set(page.entries.filter((entry) => entry.entity === "topic").map((entry) => entry.entityId))];
  const memoCommentIds = page.entries.filter((entry) => entry.entity === "memo_comment" && entry.op === "upsert").map((entry) => entry.entityId);
  const items = await readItems(db, userId, itemIds);
  const topics = await readTopics(db, userId, topicIds);
  const existingItemIds = new Set(items.map((item) => item.id));
  const existingTopicIds = new Set(topics.map((topic) => topic.id));
  const memoComments = await readMemoComments(db, userId, memoCommentIds);
  const encryptedIds = items.filter((item) => item.content.scope !== "plain").map((item) => item.id);
  const wraps = await readItemWrapGroups(db, userId, encryptedIds);
  const topicWraps = await readTopicWrapGroups(db, userId, topics.filter((topic) => topic.isEncSpace).map((topic) => topic.id));
  const tombstones = page.entries.filter((entry) => entry.op === "delete"
      && (entry.entity === "item" ? !existingItemIds.has(entry.entityId)
        : entry.entity === "topic" ? !existingTopicIds.has(entry.entityId) : true))
    .map((entry) => toTombstone(entry, userId, now));
  return {
    items, topics, memoComments, tombstones, wraps, topicWraps, settings: await readSettings(db, userId),
    nextCursor: page.entries.length > 0 ? String(page.entries[page.entries.length - 1]!.seq) : String(cursor),
    hasMore: page.hasMore, fullResync: false,
  };
}

/** 回收站永久删除（G8，FR-VER-6）：仅已软删行；墓碑在软删时已传播；包装块随行清除。 */
export async function purgeTrashItems(db: D1Database, userId: string, ids: string[]): Promise<number> {
  return purgeDeletedItems(db, userId, ids);
}
