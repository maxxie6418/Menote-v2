import type { Item, TopicNode } from "@menote/shared";
import type { OutboxOperation, SyncConflictDetail, SyncOperationResult } from "@menote/shared";
import { ensureAttachmentRow, setAttachmentRefs } from "../db/attachments";
import { putItemWraps, putTopicWraps } from "../db/keyWraps";
import {
  appendSyncLog, countItemReferences, markItemDeleted, purgeSyncOperations, readItemAttachmentHashes,
  readItemState, readSyncOperation, recordSyncOperation, upsertItemRow, upsertTopicRow,
} from "../db/sync";

/**
 * 同步引擎服务端编排（G6，按 G2 定稿：管理线计划「专项设计 — 同步契约与边界」）。
 * 逐操作独立 D1 batch 事务；幂等 (user_id, operation_id)；冲突不回滚批内其他操作。
 * SQL 一律在 db 层（db/sync.ts、db/attachments.ts）。
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

async function applyItemUpsert(ctx: ApplyContext, operation: OutboxOperation): Promise<SyncOperationResult> {
  const item = (operation.payload as { item?: Item } | null)?.item;
  // 载荷中的 userId 一律忽略：归属以会话用户为准（FR-USR-3，服务端不信任客户端标识）。
  if (!item || item.id !== operation.entityId) throw new SyncRejected("invalid_payload");
  const current = await readItemState(ctx.db, ctx.userId, item.id);
  if (current) {
    // 正文未变化时无需判为冲突；即使本地 rev/metaRev 已落后，也按服务端胜出的重复操作收敛。
    if (current.contentHash === item.contentHash &&
        (current.rev !== operation.baseRev || current.metaRev !== operation.baseMetaRev)) {
      return { operationId: operation.operationId, result: "duplicate", rev: current.rev, metaRev: current.metaRev, contentHash: current.contentHash };
    }
    if (item.type === "memo") {
      // Memo 字段级 LWW（FR-SYNC-5）：以服务端接收时序为准，不产生冲突副本。
      if (item.updatedAt <= current.updatedAt) {
        return { operationId: operation.operationId, result: "duplicate", rev: current.rev, metaRev: current.metaRev, contentHash: current.contentHash };
      }
    } else if (current.rev !== operation.baseRev || current.metaRev !== operation.baseMetaRev) {
      await recordSyncOperation(ctx.db, ctx.userId, operation.operationId, "item", item.id, "conflict", current.rev, current.metaRev, current.contentHash, ctx.now);
      return conflictResult(operation.operationId, current);
    }
  }
  const rev = Math.max(item.rev, (current?.rev ?? 0) + 1);
  const metaRev = Math.max(item.metaRev, (current?.metaRev ?? 0) + 1);
  const previousRefs = current ? (() => {
    try { return JSON.parse(current.attachmentHashesJson) as string[]; } catch { return []; }
  })() : [];
  await upsertItemRow(ctx.db, ctx.userId, ctx.deviceId, item, rev, metaRev);
  if (operation.wraps && operation.wraps.length > 0) {
    await putItemWraps(ctx.db, ctx.userId, item.id, operation.wraps, ctx.now);
  }
  await appendSyncLog(ctx.db, ctx.userId, "item", item.id, "upsert", rev, metaRev, ctx.now);
  await recordSyncOperation(ctx.db, ctx.userId, operation.operationId, "item", item.id, "applied", rev, metaRev, item.contentHash, ctx.now);
  // 引用对齐覆盖旧+新引用集合：移除引用后计数同样要下降（FR-SYNC-7）。
  await realignAttachmentRefs(ctx, [...previousRefs, ...item.attachmentHashes]);
  return { operationId: operation.operationId, result: "applied", rev, metaRev };
}

/** 软删：删除不推 rev（与客户端语义一致）；并发编辑胜由后续 upsert 复活（G2 §5-5）。 */
async function applyItemDelete(ctx: ApplyContext, operation: OutboxOperation): Promise<SyncOperationResult> {
  const current = await readItemState(ctx.db, ctx.userId, operation.entityId);
  if (!current) throw new SyncRejected("entity_missing");
  if (current.rev !== operation.baseRev || current.metaRev !== operation.baseMetaRev) {
    await recordSyncOperation(ctx.db, ctx.userId, operation.operationId, "item", operation.entityId, "conflict", current.rev, current.metaRev, current.contentHash, ctx.now);
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

/** 逐操作应用入口；单操作任何确定失败不影响其余操作（G2 §3）。 */
export async function applyOperation(ctx: ApplyContext, operation: OutboxOperation): Promise<SyncOperationResult> {
  const previous = await readSyncOperation(ctx.db, ctx.userId, operation.operationId);
  if (previous) {
    if (previous.result === "conflict") {
      return { operationId: operation.operationId, result: "conflict", detail: { rev: previous.rev, metaRev: previous.metaRev, contentHash: previous.contentHash } };
    }
    return { operationId: operation.operationId, result: "duplicate", rev: previous.rev, metaRev: previous.metaRev, contentHash: previous.contentHash };
  }
  try {
    if (operation.entity === "item") {
      return operation.action === "delete" ? await applyItemDelete(ctx, operation) : await applyItemUpsert(ctx, operation);
    }
    if (operation.entity === "topic") {
      return await applyTopic(ctx, operation);
    }
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
