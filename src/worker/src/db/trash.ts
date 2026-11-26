/** 回收站永久删除（G8）：SQL 只在 db 层。 */

const canPurgeItem = "id = ? AND user_id = ? AND deleted_at IS NOT NULL AND deleted_at <= ?";

/** Recheck trash state in the write transaction before clearing versions, wraps or references. */
export function purgeDeletedItemStatements(db: SqlDatabase, userId: string, id: string, cutoff: number) {
  return [
    db.prepare(`DELETE FROM item_versions WHERE user_id = ? AND item_id = ?
      AND EXISTS (SELECT 1 FROM items WHERE ${canPurgeItem})`).bind(userId, id, id, userId, cutoff),
    db.prepare(`DELETE FROM item_key_wraps WHERE user_id = ? AND item_id = ?
      AND EXISTS (SELECT 1 FROM items WHERE ${canPurgeItem})`).bind(userId, id, id, userId, cutoff),
    db.prepare(`DELETE FROM items WHERE ${canPurgeItem} RETURNING id`).bind(id, userId, cutoff),
  ];
}

export async function purgeDeletedItems(db: SqlDatabase, userId: string, ids: string[]): Promise<number> {
  let purged = 0;
  for (const id of ids) {
    const now = Date.now();
    const cutoff = Number.MAX_SAFE_INTEGER;
    const result = await db.batch([
      db.prepare(`INSERT INTO sync_log (user_id, entity, entity_id, op, rev, meta_rev, created_at)
        SELECT user_id, 'memo_comment', id, 'delete', rev + 1, 0, ? FROM memo_comments
        WHERE user_id = ? AND memo_id = ? AND EXISTS (SELECT 1 FROM items WHERE ${canPurgeItem})`)
        .bind(now, userId, id, id, userId, cutoff),
      db.prepare(`INSERT INTO sync_log (user_id, entity, entity_id, op, rev, meta_rev, created_at)
        SELECT user_id, 'item', id, 'delete', rev, meta_rev, ? FROM items WHERE ${canPurgeItem}`)
        .bind(now, id, userId, cutoff),
      ...purgeDeletedItemStatements(db, userId, id, cutoff),
    ]);
    purged += result.at(-1)?.results.length ?? 0;
  }
  return purged;
}
