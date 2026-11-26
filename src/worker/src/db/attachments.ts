import { SEALED_ATTACHMENT_MIME, type AttachmentPage } from "@menote/shared";

const DAY_MS = 86_400_000;
export const ATTACHMENT_ORPHAN_RETENTION_MS = 30 * DAY_MS;
const currentTime = "CAST(strftime('%s', 'now') AS INTEGER) * 1000";
const hasAnyReference = `EXISTS (
  SELECT 1 FROM attachment_item_refs
  WHERE user_id = attachments.user_id AND sha256 = attachments.sha256
)`;

/** Register a distinct R2 object before the put; an interrupted upload can then be collected. */
export async function reserveAttachmentObjects(db: SqlDatabase, keys: string[], now: number): Promise<void> {
  await db.prepare("INSERT INTO attachment_object_deletions (object_key, delete_after) SELECT value, ? FROM json_each(?)")
    .bind(now + DAY_MS, JSON.stringify(keys)).run();
}

/** Publish only a live reservation. The existing NOT NULL size constraint aborts
 * a missing or expired reservation, including within a larger restore batch. */
export function publishAttachmentStatements(
  db: SqlDatabase, userId: string, sha256: string, size: number, mime: string, key: string, now: number,
): SqlStatement[] {
  return [
    db.prepare(
      `INSERT INTO attachments (user_id, sha256, size, mime, ref_count, orphaned_at, r2_key)
       VALUES (?, ?, (SELECT ? FROM attachment_object_deletions WHERE object_key = ?
         AND claimed = 0 AND delete_after > ${currentTime}), ?, 0, ?, ?)
       ON CONFLICT (user_id, sha256) DO UPDATE SET size = excluded.size, r2_key = excluded.r2_key, retired_at = NULL,
         orphaned_at = CASE WHEN ${hasAnyReference} THEN NULL ELSE excluded.orphaned_at END,
         mime = CASE WHEN attachments.mime = ? OR excluded.mime = 'application/octet-stream'
           THEN attachments.mime ELSE excluded.mime END`,
    ).bind(userId, sha256, size, key, mime, now, key, SEALED_ATTACHMENT_MIME),
    db.prepare("DELETE FROM attachment_object_deletions WHERE object_key = ?").bind(key),
  ];
}

export async function getAttachmentObject(db: SqlDatabase, userId: string, sha256: string) {
  return db.prepare(`SELECT mime, COALESCE(r2_key, user_id || '/' || sha256) AS key
    FROM attachments WHERE user_id = ? AND sha256 = ? AND retired_at IS NULL`)
    .bind(userId, sha256).first<{ mime: string; key: string }>();
}

/** Extend the observation window for bytes just uploaded again, or fall back to a new object when retired. */
export async function reuseAttachmentObject(
  db: SqlDatabase, userId: string, sha256: string, key: string, size: number, mime: string, now: number,
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE attachments SET size = ?,
       orphaned_at = CASE WHEN ${hasAnyReference} THEN NULL ELSE ? END,
       mime = CASE WHEN attachments.mime = ? THEN attachments.mime ELSE ? END
     WHERE user_id = ? AND sha256 = ? AND r2_key = ? AND retired_at IS NULL`,
  ).bind(size, now, SEALED_ATTACHMENT_MIME, mime, userId, sha256, key).run();
  return (result.meta.changes ?? 0) === 1;
}

const ATTACHMENT_PAGE_SIZE = 500;

export async function listAttachments(db: SqlDatabase, userId: string, cursor: string): Promise<AttachmentPage> {
  const rows = await db.prepare(
    `SELECT user_id, sha256, size, mime, orphaned_at, r2_key,
      (SELECT COUNT(*) FROM attachment_item_refs AS ref
       WHERE ref.user_id = attachments.user_id AND ref.sha256 = attachments.sha256) AS ref_count
    FROM attachments WHERE user_id = ? AND sha256 > ? AND retired_at IS NULL ORDER BY sha256 LIMIT ?`,
  ).bind(userId, cursor, ATTACHMENT_PAGE_SIZE + 1).all<{
    user_id: string; sha256: string; size: number; mime: string; ref_count: number; orphaned_at: number | null; r2_key: string | null;
  }>();
  const attachments = rows.results.slice(0, ATTACHMENT_PAGE_SIZE).map((row) => ({
    userId: row.user_id, sha256: row.sha256, size: row.size, mime: row.mime, refCount: row.ref_count,
    cleanupEligibleAt: row.ref_count === 0 && row.orphaned_at !== null && row.r2_key !== null
      ? row.orphaned_at + ATTACHMENT_ORPHAN_RETENTION_MS : null,
  }));
  return rows.results.length > ATTACHMENT_PAGE_SIZE
    ? { attachments, nextCursor: attachments.at(-1)!.sha256 }
    : { attachments };
}

const retireAttachment = "UPDATE attachments SET retired_at = ?, size = 0, ref_count = 0, orphaned_at = NULL";
const cleanupEligible = `retired_at IS NULL AND r2_key IS NOT NULL
  AND orphaned_at <= ? AND NOT ${hasAnyReference}`;
const CLEANUP_BATCH_SIZE = 1000; // R2 bulk delete limit.

/** A single D1 statement checks live references, tombstones the hash and enqueues its exact key. */
export async function retireUserAttachment(db: SqlDatabase, userId: string, sha256: string, now: number) {
  const retired = await db.prepare(
    `${retireAttachment} WHERE user_id = ? AND sha256 = ? AND ${cleanupEligible} RETURNING r2_key AS key`,
  ).bind(now, userId, sha256, now - ATTACHMENT_ORPHAN_RETENTION_MS).first<{ key: string }>();
  if (retired) return { status: "retired" as const, key: retired.key };
  const current = await db.prepare(
    `SELECT retired_at, r2_key AS key, ${hasAnyReference} AS referenced FROM attachments WHERE user_id = ? AND sha256 = ?`,
  ).bind(userId, sha256).first<{ retired_at: number | null; key: string | null; referenced: number }>();
  if (!current) return { status: "not_found" as const };
  if (current.retired_at !== null && current.key) return { status: "retired" as const, key: current.key };
  return { status: current.referenced ? "attachment_referenced" as const : "attachment_retention_active" as const };
}

export async function retireExpiredAttachments(db: SqlDatabase, now: number): Promise<void> {
  await db.prepare(`${retireAttachment} WHERE rowid IN (
    SELECT rowid FROM attachments WHERE ${cleanupEligible}
    ORDER BY orphaned_at LIMIT ${CLEANUP_BATCH_SIZE}
  )`).bind(now, now - ATTACHMENT_ORPHAN_RETENTION_MS).run();
}

/** Claim due objects atomically. An expired put can never publish after this statement. */
export async function claimDueAttachmentDeletions(db: SqlDatabase, now: number): Promise<string[]> {
  const rows = await db.prepare(
    `UPDATE attachment_object_deletions SET claimed = 1 WHERE object_key IN (
       SELECT object_key FROM attachment_object_deletions WHERE delete_after <= ?
       ORDER BY delete_after, object_key LIMIT ${CLEANUP_BATCH_SIZE}
     ) RETURNING object_key`,
  ).bind(now).all<{ object_key: string }>();
  return rows.results.map((row) => row.object_key);
}

export async function acknowledgeAttachmentDeletions(db: SqlDatabase, keys: string[]): Promise<void> {
  await db.prepare(
    "DELETE FROM attachment_object_deletions WHERE claimed = 1 AND object_key IN (SELECT value FROM json_each(?))",
  ).bind(JSON.stringify(keys)).run();
}

/** 引用对齐时补齐缺失的元数据行（不覆盖既有 size/mime；计数另设）。 */
/** 与条目写放进同一次 batch：计数子查询能看见本批刚写入的哈希列表。 */
export function realignAttachmentStatements(db: SqlDatabase, userId: string, sha256: string, now: number): SqlStatement[] {
  const countSql = `SELECT COUNT(*) FROM attachment_item_refs AS ref CROSS JOIN items ON items.id = ref.item_id
     WHERE ref.user_id = ? AND ref.sha256 = ? AND items.deleted_at IS NULL`;
  return [
    db.prepare(
      `INSERT INTO attachments (user_id, sha256, size, mime, ref_count) VALUES (?, ?, 0, 'application/octet-stream', 0)
       ON CONFLICT (user_id, sha256) DO NOTHING`,
    ).bind(userId, sha256),
    db.prepare(
      `UPDATE attachments SET ref_count = (${countSql}),
         orphaned_at = CASE WHEN ${hasAnyReference} THEN NULL ELSE COALESCE(orphaned_at, ?) END
       WHERE user_id = ? AND sha256 = ? AND retired_at IS NULL`,
    ).bind(userId, sha256, now, userId, sha256),
  ];
}
