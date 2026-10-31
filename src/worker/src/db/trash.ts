/** 回收站永久删除（G8）：SQL 只在 db 层。 */
import { deleteItemWraps } from "./keyWraps";

export async function purgeDeletedItems(db: D1Database, userId: string, ids: string[]): Promise<number> {
  let purged = 0;
  for (const id of ids) {
    const result = await db.prepare(
      "DELETE FROM items WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL",
    ).bind(id, userId).run();
    if ((result.meta.changes ?? 0) > 0) {
      await deleteItemWraps(db, userId, id);
      purged += 1;
    }
  }
  return purged;
}
