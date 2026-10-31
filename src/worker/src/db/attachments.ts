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

/** G6 推送应用时按正文哈希列表对齐引用计数。 */
export async function setAttachmentRefs(
  db: D1Database, userId: string, sha256: string, refCount: number,
): Promise<void> {
  await db.prepare("UPDATE attachments SET ref_count = ? WHERE user_id = ? AND sha256 = ?")
    .bind(Math.max(0, refCount), userId, sha256).run();
}
