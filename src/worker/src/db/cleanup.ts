/** 清理任务数据访问（G10，FR-SYNC-8 + G2 保留期定稿）。SQL 只在 db 层。 */

export interface UserRow { id: string }

export async function listUsers(db: D1Database): Promise<UserRow[]> {
  const rows = await db.prepare("SELECT id FROM users").all<UserRow>();
  return rows.results;
}

/** 软删超过保留期的条目（90 天）。 */
export async function listExpiredSoftDeleted(db: D1Database, userId: string, cutoff: number): Promise<string[]> {
  const rows = await db.prepare(
    "SELECT id FROM items WHERE user_id = ? AND deleted_at IS NOT NULL AND deleted_at <= ? LIMIT 500",
  ).bind(userId, cutoff).all<{ id: string }>();
  return rows.results.map((row) => row.id);
}

export async function purgeItemsWithWraps(db: D1Database, userId: string, ids: string[]): Promise<void> {
  for (const id of ids) {
    // item_versions has a restrictive FK; purge snapshots before deleting the owning item.
    await db.prepare("DELETE FROM item_versions WHERE user_id = ? AND item_id = ?").bind(userId, id).run();
    await db.prepare("DELETE FROM items WHERE id = ? AND user_id = ?").bind(id, userId).run();
    await db.prepare("DELETE FROM item_key_wraps WHERE user_id = ? AND item_id = ?").bind(userId, id).run();
  }
}

export async function purgeSyncLogBefore(db: D1Database, userId: string, cutoff: number): Promise<void> {
  await db.prepare("DELETE FROM sync_log WHERE user_id = ? AND created_at <= ?").bind(userId, cutoff).run();
}

export async function purgeSyncOperationsBefore(db: D1Database, userId: string, cutoff: number): Promise<void> {
  await db.prepare("DELETE FROM sync_operations WHERE user_id = ? AND created_at <= ?").bind(userId, cutoff).run();
}

export async function purgeJobRunsBefore(db: D1Database, cutoff: number): Promise<void> {
  await db.prepare("DELETE FROM job_runs WHERE started_at <= ?").bind(cutoff).run();
}
