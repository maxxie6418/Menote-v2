/** 回收站永久删除（G8）：SQL 只在 db 层。 */
import { deleteItemWraps } from "./keyWraps";

export async function purgeDeletedItems(db: D1Database, userId: string, ids: string[]): Promise<number> {
  let purged = 0;
  for (const id of ids) {
    const item = await db.prepare("SELECT type, rev, meta_rev FROM items WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL")
      .bind(id, userId).first<{ type: string; rev: number; meta_rev: number }>();
    if (!item) continue;
    const now = Date.now();
    const comments = item.type === "memo"
      ? await db.prepare("SELECT id, rev FROM memo_comments WHERE user_id = ? AND memo_id = ?").bind(userId, id).all<{ id: string; rev: number }>()
      : { results: [] as Array<{ id: string; rev: number }> };
    const changes = [
      ...comments.results.map((comment) => db.prepare(
        "INSERT INTO sync_log (user_id, entity, entity_id, op, rev, meta_rev, created_at) VALUES (?, 'memo_comment', ?, 'delete', ?, 0, ?)",
      ).bind(userId, comment.id, comment.rev + 1, now)),
      db.prepare("INSERT INTO sync_log (user_id, entity, entity_id, op, rev, meta_rev, created_at) VALUES (?, 'item', ?, 'delete', ?, ?, ?)")
        .bind(userId, id, item.rev, item.meta_rev, now),
      db.prepare("DELETE FROM items WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL").bind(id, userId),
    ];
    const result = await db.batch(changes);
    if ((result[result.length - 1]?.meta.changes ?? 0) > 0) {
      await deleteItemWraps(db, userId, id);
      purged += 1;
    }
  }
  return purged;
}
