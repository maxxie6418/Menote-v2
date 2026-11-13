import type { Attachment } from "@menote/shared";

/** 附件元数据（G5）：R2 对象键 `<userId>/<sha256>`；引用计数随正文哈希列表对齐（G6 推送时更新）。 */

export async function upsertAttachment(
  db: D1Database, userId: string, sha256: string, size: number, mime: string,
): Promise<void> {
  await db.prepare(
    `INSERT INTO attachments (user_id, sha256, size, mime, ref_count) VALUES (?, ?, ?, ?, 0)
     ON CONFLICT (user_id, sha256) DO UPDATE SET size = excluded.size, mime = excluded.mime`,
  ).bind(userId, sha256, size, mime).run();
}

export async function getAttachment(db: D1Database, userId: string, sha256: string): Promise<Attachment | null> {
  const row = await db.prepare(
    "SELECT user_id, sha256, size, mime, ref_count FROM attachments WHERE user_id = ? AND sha256 = ?",
  ).bind(userId, sha256).first<{ user_id: string; sha256: string; size: number; mime: string; ref_count: number }>();
  return row ? { userId: row.user_id, sha256: row.sha256, size: row.size, mime: row.mime, refCount: row.ref_count } : null;
}

export async function listAttachments(db: D1Database, userId: string): Promise<Attachment[]> {
  const rows = await db.prepare(
    "SELECT user_id, sha256, size, mime, ref_count FROM attachments WHERE user_id = ? ORDER BY sha256 LIMIT 500",
  ).bind(userId).all<{ user_id: string; sha256: string; size: number; mime: string; ref_count: number }>();
  return rows.results.map((row) => ({
    userId: row.user_id, sha256: row.sha256, size: row.size, mime: row.mime, refCount: row.ref_count,
  }));
}

/** 仅引用计数为 0 时允许删除（FR-SYNC-8 真删延迟 30 天由 G10 cleanup 执行）。 */
export async function deleteAttachmentIfUnreferenced(db: D1Database, userId: string, sha256: string): Promise<boolean> {
  const row = await db.prepare(
    "SELECT ref_count FROM attachments WHERE user_id = ? AND sha256 = ?",
  ).bind(userId, sha256).first<{ ref_count: number }>();
  if (!row || row.ref_count > 0) return false;
  await db.prepare("DELETE FROM attachments WHERE user_id = ? AND sha256 = ?").bind(userId, sha256).run();
  return true;
}

/** G6 推送应用时按正文哈希列表对齐引用计数；归零进入孤儿观察期（30 天后真删，G10）。 */
export async function setAttachmentRefs(
  db: D1Database, userId: string, sha256: string, refCount: number, now = Date.now(),
): Promise<void> {
  await db.prepare(
    `UPDATE attachments SET ref_count = ?,
       orphaned_at = CASE WHEN ? > 0 THEN NULL ELSE COALESCE(orphaned_at, ?) END
     WHERE user_id = ? AND sha256 = ?`,
  ).bind(Math.max(0, refCount), Math.max(0, refCount), now, userId, sha256).run();
}

export async function countAttachmentRefs(db: D1Database, userId: string, sha256: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM items WHERE user_id = ? AND deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM json_each(items.attachment_hashes_json) WHERE json_each.value = ?)`)
    .bind(userId, sha256).first<{ count: number }>();
  return row?.count ?? 0;
}

export interface OrphanRow { userId: string; sha256: string }

/** 孤儿期已满（30 天）的附件清单。 */
export async function listExpiredOrphans(db: D1Database, cutoff: number): Promise<OrphanRow[]> {
  const rows = await db.prepare(
    "SELECT user_id, sha256 FROM attachments WHERE ref_count = 0 AND orphaned_at IS NOT NULL AND orphaned_at <= ? LIMIT 200",
  ).bind(cutoff).all<{ user_id: string; sha256: string }>();
  return rows.results.map((row) => ({ userId: row.user_id, sha256: row.sha256 }));
}

export async function deleteAttachmentRow(db: D1Database, userId: string, sha256: string): Promise<void> {
  await db.prepare("DELETE FROM attachments WHERE user_id = ? AND sha256 = ?").bind(userId, sha256).run();
}

/** 引用对齐时补齐缺失的元数据行（不覆盖既有 size/mime；计数另设）。 */
/** 与条目写放进同一次 batch：计数子查询能看见本批刚写入的哈希列表。 */
export function realignAttachmentStatements(db: D1Database, userId: string, sha256: string, now: number): D1PreparedStatement[] {
  const countSql = `SELECT COUNT(*) FROM items WHERE user_id = ? AND deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM json_each(items.attachment_hashes_json) WHERE json_each.value = ?)`;
  return [
    db.prepare(
      `INSERT INTO attachments (user_id, sha256, size, mime, ref_count) VALUES (?, ?, 0, 'application/octet-stream', 0)
       ON CONFLICT (user_id, sha256) DO NOTHING`,
    ).bind(userId, sha256),
    db.prepare(
      `UPDATE attachments SET ref_count = (${countSql}),
         orphaned_at = CASE WHEN (${countSql}) > 0 THEN NULL ELSE COALESCE(orphaned_at, ?) END
       WHERE user_id = ? AND sha256 = ?`,
    ).bind(userId, sha256, userId, sha256, now, userId, sha256),
  ];
}

export async function ensureAttachmentRow(db: D1Database, userId: string, sha256: string): Promise<void> {
  await db.prepare(
    `INSERT INTO attachments (user_id, sha256, size, mime, ref_count) VALUES (?, ?, 0, 'application/octet-stream', 0)
     ON CONFLICT (user_id, sha256) DO NOTHING`,
  ).bind(userId, sha256).run();
}
