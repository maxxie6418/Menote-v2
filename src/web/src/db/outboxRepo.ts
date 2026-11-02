import type { OutboxOperation } from "@menote/shared";
import { localDb, type OutboxRow } from "./localDb";

/** outbox 队列（G2 专项设计 §3）：本地写与入队同一 Dexie 事务；正文不复制进队列。 */

export function toOutboxRow(operation: OutboxOperation, now: number): OutboxRow {
  return {
    userId: operation.userId,
    operationId: operation.operationId,
    entityId: operation.entityId,
    entity: operation.entity,
    action: operation.action,
    baseRev: operation.baseRev,
    baseMetaRev: operation.baseMetaRev,
    contentHash: operation.contentHash,
    attachmentRefs: operation.attachmentRefs,
    payload: operation.payload,
    queuedAt: now,
    retries: 0,
    nextRetryAt: null,
    lastError: null,
  };
}

export async function enqueueOutbox(rows: OutboxRow[]): Promise<void> {
  await localDb.outbox.bulkAdd(rows);
}

/** 队首可推送操作：nextRetryAt 已到期或为空，按 seq 稳定排序，单轮上限由调用方裁剪。 */
export async function listPendingOutbox(userId: string, limit = 20): Promise<OutboxRow[]> {
  const now = Date.now();
  const rows = await localDb.outbox.orderBy("seq").toArray();
  return rows.filter((row) => row.userId === userId && (row.nextRetryAt === null || row.nextRetryAt <= now)).slice(0, limit);
}

export async function countPendingOutbox(): Promise<number> {
  return localDb.outbox.count();
}

export async function markOutboxError(seq: number, lastError: string, retryInMs: number): Promise<void> {
  const current = await localDb.outbox.get(seq);
  await localDb.outbox.update(seq, {
    retries: (current?.retries ?? 0) + 1,
    nextRetryAt: Date.now() + retryInMs,
    lastError,
  });
}

export async function deleteOutboxRows(seqs: number[]): Promise<void> {
  await localDb.outbox.bulkDelete(seqs);
}
