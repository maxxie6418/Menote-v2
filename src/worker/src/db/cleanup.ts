/** 清理任务数据访问（G10，FR-SYNC-8 + G2 保留期定稿）。SQL 只在 db 层。 */
import { purgeDeletedItemStatements } from "./trash";

export interface UserRow { id: string }

export async function listUsers(db: SqlDatabase): Promise<UserRow[]> {
  const rows = await db.prepare("SELECT id FROM users").all<UserRow>();
  return rows.results;
}

/** 软删超过保留期的条目（90 天）。 */
export async function listExpiredSoftDeleted(db: SqlDatabase, userId: string, cutoff: number): Promise<string[]> {
  const rows = await db.prepare(
    "SELECT id FROM items WHERE user_id = ? AND deleted_at IS NOT NULL AND deleted_at <= ? LIMIT 500",
  ).bind(userId, cutoff).all<{ id: string }>();
  return rows.results.map((row) => row.id);
}

export async function purgeItemsWithWraps(db: SqlDatabase, userId: string, ids: string[], cutoff: number): Promise<void> {
  for (const id of ids) {
    await db.batch(purgeDeletedItemStatements(db, userId, id, cutoff));
  }
}

export async function purgeSyncLogBefore(db: SqlDatabase, userId: string, cutoff: number): Promise<void> {
  await db.prepare("DELETE FROM sync_log WHERE user_id = ? AND created_at <= ?").bind(userId, cutoff).run();
}

export async function purgeSyncOperationsBefore(db: SqlDatabase, userId: string, cutoff: number): Promise<void> {
  await db.prepare("DELETE FROM sync_operations WHERE user_id = ? AND created_at <= ?").bind(userId, cutoff).run();
}

export async function purgeJobRunsBefore(db: SqlDatabase, cutoff: number): Promise<void> {
  await db.prepare("DELETE FROM job_runs WHERE started_at <= ?").bind(cutoff).run();
}
