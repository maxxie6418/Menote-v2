import type { OutboxOperation, UserSetting } from "@menote/shared";
import { newId } from "../lib/hash";
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

/** 旧服务端把 ai / raindrop 设置拒绝后停在永久退避。放行后下一轮再推，不必让用户重开一次开关。 */
export async function releaseParkedSettings(userId: string): Promise<void> {
  const rows = await localDb.outbox.where("userId").equals(userId).toArray();
  const stuck = rows.filter((row) => row.entity === "setting" && row.lastError?.startsWith("rejected:"));
  await Promise.all(stuck.map((row) => localDb.outbox.update(row.seq!, { nextRetryAt: null })));
}

/** 重新排入历史上因 entity_missing 被永久退避的条目删除；缺失删除现在按幂等成功收敛。 */
export async function releaseMissingItemDeletes(userId: string): Promise<void> {
  const rows = await localDb.outbox.where("userId").equals(userId).toArray();
  const stuck = rows.filter((row) => row.entity === "item" && row.action === "delete" && row.lastError === "rejected:entity_missing");
  await Promise.all(stuck.map((row) => localDb.outbox.update(row.seq!, { nextRetryAt: null })));
}

/**
 * 设置操作落败收尾（G2 §5）：本地 rev 对齐服务端实测值，避免乐观 rev 漂移后
 * baseRev 永久错位、后续每次推送都撞冲突被丢；仍需生效的写入按修正后的 baseRev
 * 重排一条新操作（同 operationId 会被服务端幂等记录挡回），重排至多 2 次防并发互写死循环。
 */
export async function settleSettingResult(row: OutboxRow, serverRev: number, requeue: boolean): Promise<void> {
  await localDb.transaction("rw", localDb.settings, localDb.outbox, async () => {
    const current = await localDb.settings.get([row.userId, row.entityId]);
    if (current && current.rev !== serverRev) await localDb.settings.put({ ...current, rev: serverRev });
    await localDb.outbox.delete(row.seq!);
    if (!requeue || row.retries >= 2 || !current) return;
    const queued = await localDb.outbox.where("userId").equals(row.userId)
      .and((entry) => entry.entity === "setting" && entry.entityId === row.entityId).count();
    if (queued > 0) return;
    const setting: UserSetting = { ...current, rev: serverRev + 1, updatedAt: Date.now() };
    const retry = toOutboxRow({
      operationId: newId(), userId: row.userId, entityId: row.entityId, entity: "setting", action: "upsert",
      baseRev: serverRev, baseMetaRev: 0, payload: { setting },
    }, Date.now());
    retry.retries = row.retries + 1;
    await enqueueOutbox([retry]);
  });
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

/** 用户手动同步时提前重试暂时性失败；确定性拒绝继续保留，避免反复发送无效操作。 */
export async function retryOutboxNow(userId: string): Promise<void> {
  const rows = await localDb.outbox.where("userId").equals(userId).toArray();
  const retryable = rows.filter((row) => row.lastError && !row.lastError.startsWith("rejected:"));
  await localDb.transaction("rw", localDb.outbox, async () => {
    for (const row of retryable) await localDb.outbox.update(row.seq!, { nextRetryAt: null });
  });
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
