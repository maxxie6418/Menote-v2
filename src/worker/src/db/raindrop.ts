import type { Item, RaindropSyncRunView } from "@menote/shared";
import { rowToItem } from "./sync";

/** Raindrop 连接器 D1 访问层（TP9）：账号令牌（密文）、绑定配置、行级账本、同步运行记录。 */

export interface RaindropBindingRow {
  user_id: string;
  table_item_id: string;
  collection_id: number;
  pull_interval_hours: number;
  last_pull_at: number | null;
  last_push_at: number | null;
  last_snapshot_key: string | null;
  last_snapshot_hash: string | null;
  last_snapshot_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface RaindropSyncRowRow {
  user_id: string;
  menote_row_id: string;
  raindrop_id: string;
  baseline_json: string;
  baseline_hash: string;
  status: "synced" | "dirty" | "conflict" | "orphaned" | "remote_missing";
  updated_at: number;
}

export async function readAccountTokenCipher(db: D1Database, userId: string): Promise<string | null> {
  const row = await db.prepare("SELECT token_ciphertext FROM raindrop_accounts WHERE user_id = ?")
    .bind(userId).first<{ token_ciphertext: string }>();
  return row?.token_ciphertext ?? null;
}

export async function upsertAccountToken(db: D1Database, userId: string, cipher: string, now: number): Promise<void> {
  await db.prepare(
    `INSERT INTO raindrop_accounts (user_id, token_ciphertext, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET token_ciphertext = excluded.token_ciphertext, updated_at = excluded.updated_at`,
  ).bind(userId, cipher, now, now).run();
}

export async function deleteAccountToken(db: D1Database, userId: string): Promise<void> {
  await db.prepare("DELETE FROM raindrop_accounts WHERE user_id = ?").bind(userId).run();
}

export async function readBinding(db: D1Database, userId: string): Promise<RaindropBindingRow | null> {
  return await db.prepare("SELECT * FROM raindrop_bindings WHERE user_id = ?")
    .bind(userId).first<RaindropBindingRow>();
}

export async function listBindings(db: D1Database): Promise<RaindropBindingRow[]> {
  const result = await db.prepare("SELECT * FROM raindrop_bindings").all<RaindropBindingRow>();
  return result.results;
}

export async function upsertBinding(
  db: D1Database, userId: string,
  config: { tableItemId: string; collectionId: number; pullIntervalHours: number }, now: number,
): Promise<void> {
  await db.prepare(
    `INSERT INTO raindrop_bindings (user_id, table_item_id, collection_id, pull_interval_hours, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       table_item_id = excluded.table_item_id, collection_id = excluded.collection_id,
       pull_interval_hours = excluded.pull_interval_hours, updated_at = excluded.updated_at`,
  ).bind(userId, config.tableItemId, config.collectionId, config.pullIntervalHours, now, now).run();
}

export async function deleteBinding(db: D1Database, userId: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM raindrop_bindings WHERE user_id = ?").bind(userId),
    db.prepare("DELETE FROM raindrop_sync_rows WHERE user_id = ?").bind(userId),
  ]);
}

export async function markPullDone(
  db: D1Database, userId: string,
  snapshot: { key: string | null; hash: string | null; at: number | null }, now: number,
): Promise<void> {
  await db.prepare(
    `UPDATE raindrop_bindings SET last_pull_at = ?, last_snapshot_key = ?, last_snapshot_hash = ?,
       last_snapshot_at = ?, updated_at = ? WHERE user_id = ?`,
  ).bind(now, snapshot.key, snapshot.hash, snapshot.at, now, userId).run();
}

export async function markPushDone(db: D1Database, userId: string, now: number): Promise<void> {
  await db.prepare("UPDATE raindrop_bindings SET last_push_at = ?, updated_at = ? WHERE user_id = ?")
    .bind(now, now, userId).run();
}

export async function listSyncRows(db: D1Database, userId: string): Promise<RaindropSyncRowRow[]> {
  const result = await db.prepare("SELECT * FROM raindrop_sync_rows WHERE user_id = ?").bind(userId).all<RaindropSyncRowRow>();
  return result.results;
}

/** 批量写入账本行（拉取成功的基线刷新与新行登记；同键覆盖）。 */
export async function upsertSyncRows(db: D1Database, userId: string, rows: RaindropSyncRowRow[]): Promise<void> {
  if (!rows.length) return;
  await db.batch(rows.map((row) => db.prepare(
    `INSERT INTO raindrop_sync_rows (user_id, menote_row_id, raindrop_id, baseline_json, baseline_hash, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, menote_row_id) DO UPDATE SET
       raindrop_id = excluded.raindrop_id, baseline_json = excluded.baseline_json,
       baseline_hash = excluded.baseline_hash, status = excluded.status, updated_at = excluded.updated_at`,
  ).bind(row.user_id, row.menote_row_id, row.raindrop_id, row.baseline_json, row.baseline_hash, row.status, row.updated_at)));
}

export async function updateSyncRowStatuses(
  db: D1Database, userId: string, statuses: Array<{ menoteRowId: string; status: RaindropSyncRowRow["status"] }>, now: number,
): Promise<void> {
  if (!statuses.length) return;
  await db.batch(statuses.map((entry) => db.prepare(
    "UPDATE raindrop_sync_rows SET status = ?, updated_at = ? WHERE user_id = ? AND menote_row_id = ?",
  ).bind(entry.status, now, userId, entry.menoteRowId)));
}

export interface SyncRunInput {
  direction: "pull" | "push";
  source: "scheduled" | "manual";
  startedAt: number;
  finishedAt: number;
  status: RaindropSyncRunView["status"];
  pulledNew: number;
  pulledUpdated: number;
  conflicts: number;
  remoteMissing: number;
  orphans: number;
  pushCreated: number;
  pushUpdated: number;
  pushFailed: number;
  detail: string | null;
}

export async function insertSyncRun(db: D1Database, userId: string, run: SyncRunInput): Promise<void> {
  await db.prepare(
    `INSERT INTO raindrop_sync_runs (user_id, direction, source, started_at, finished_at, status,
       pulled_new, pulled_updated, conflicts, remote_missing, orphans, push_created, push_updated, push_failed, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(userId, run.direction, run.source, run.startedAt, run.finishedAt, run.status,
    run.pulledNew, run.pulledUpdated, run.conflicts, run.remoteMissing, run.orphans,
    run.pushCreated, run.pushUpdated, run.pushFailed, run.detail).run();
}

export async function listSyncRuns(db: D1Database, userId: string, limit = 20): Promise<RaindropSyncRunView[]> {
  const result = await db.prepare(
    `SELECT id, direction, source, started_at, finished_at, status, pulled_new, pulled_updated,
            conflicts, remote_missing, orphans, push_created, push_updated, push_failed, detail
     FROM raindrop_sync_runs WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
  ).bind(userId, limit).all<Record<string, unknown>>();
  return result.results.map((row) => ({
    id: Number(row.id), direction: row.direction as RaindropSyncRunView["direction"],
    source: row.source as RaindropSyncRunView["source"], startedAt: Number(row.started_at),
    finishedAt: Number(row.finished_at), status: row.status as RaindropSyncRunView["status"],
    pulledNew: Number(row.pulled_new), pulledUpdated: Number(row.pulled_updated),
    conflicts: Number(row.conflicts), remoteMissing: Number(row.remote_missing),
    orphans: Number(row.orphans), pushCreated: Number(row.push_created),
    pushUpdated: Number(row.push_updated), pushFailed: Number(row.push_failed),
    detail: (row.detail as string | null) ?? null,
  }));
}

/** 绑定目标必须是用户本人的明文表格文档（与 MCP 收藏目标同一加密/软删边界，但不做范围裁剪）。 */
export async function readRaindropTarget(db: D1Database, userId: string, itemId: string): Promise<Item | null> {
  const row = await db.prepare(
    `SELECT i.* FROM items i
       LEFT JOIN topic_nodes topic ON topic.user_id = i.user_id AND topic.id = i.topic_id
       LEFT JOIN topic_nodes grp ON grp.user_id = i.user_id AND grp.id = i.group_id
     WHERE i.user_id = ? AND i.id = ? AND i.deleted_at IS NULL AND i.enc_self = 0 AND i.in_enc_space = 0
       AND i.content_ciphertext IS NULL AND (topic.is_enc_space IS NULL OR topic.is_enc_space = 0)
       AND (grp.is_enc_space IS NULL OR grp.is_enc_space = 0) AND i.type = 'table'
     LIMIT 1`,
  ).bind(userId, itemId).first<Record<string, unknown>>();
  return row ? rowToItem(row) : null;
}
