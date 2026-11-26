import { recoveryBindingFromRow, recoveryCodeReadStatement } from "./recoveryCode";

/** 备份目标与凭据（G9）。secret 仅存可逆加密密文（C-7：默认不明文展示、支持事后查看与复制分发）。 */

interface TargetRow {
  id: string; user_id: string; kind: string; endpoint: string | null; bucket: string | null;
  username: string | null; secret_ciphertext: string | null; delete_policy: string;
  schedule: string | null; enabled: number; name: string | null;
  remote_path?: string; retention_count?: number; last_pushed_at?: number | null;
  cursor_seq?: number; last_result?: string | null;
}
function toTarget(row: TargetRow) {
  return {
    id: row.id, userId: row.user_id,
    kind: row.kind === "s3" ? "s3" : "webdav",
    endpoint: row.endpoint ?? "", bucket: row.bucket, username: row.username,
    remotePath: row.remote_path ?? "menote", retentionCount: row.retention_count ?? 0,
    lastPushedAt: row.last_pushed_at ?? null,
    secretCiphertext: row.secret_ciphertext,
    deletePolicy: row.delete_policy === "sync" ? "sync" : "append_only",
    schedule: row.schedule === "weekly" ? "weekly" : row.schedule === "daily" ? "daily" : "manual",
    enabled: row.enabled === 1,
    name: row.name ?? "备份目标",
    lastResult: row.last_result ?? null,
  };
}

export async function listTargets(db: SqlDatabase, userId: string) {
  const rows = await db.prepare(
    "SELECT id, user_id, kind, endpoint, bucket, username, secret_ciphertext, delete_policy, schedule, enabled, name, remote_path, retention_count, last_pushed_at, last_result FROM backup_targets WHERE user_id = ? ORDER BY id",
  ).bind(userId).all<TargetRow>();
  return rows.results.map(toTarget);
}

export async function getTarget(db: SqlDatabase, userId: string, id: string) {
  const row = await db.prepare(
    "SELECT id, user_id, kind, endpoint, bucket, username, secret_ciphertext, delete_policy, schedule, enabled, name, remote_path, retention_count, last_pushed_at, last_result FROM backup_targets WHERE id = ? AND user_id = ?",
  ).bind(id, userId).first<TargetRow>();
  return row ? toTarget(row) : null;
}

export async function createTarget(
  db: SqlDatabase, userId: string, input: {
    kind: "s3" | "webdav"; endpoint: string; bucket: string | null; username: string | null;
    secretCiphertext: string; deletePolicy: "append_only" | "sync"; schedule: "manual" | "daily" | "weekly"; name: string;
    remotePath?: string; retentionCount: number;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO backup_targets (id, user_id, kind, endpoint, bucket, username, secret_ciphertext, delete_policy, schedule, enabled, name, remote_path, retention_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  ).bind(id, userId, input.kind, input.endpoint, input.bucket, input.username, input.secretCiphertext, input.deletePolicy, input.schedule, input.name, input.remotePath ?? "menote", input.retentionCount).run();
  return id;
}

export async function updateTarget(
  db: SqlDatabase, userId: string, id: string, patch: {
    name?: string; endpoint?: string; bucket?: string | null; username?: string | null;
    secretCiphertext?: string; schedule?: "manual" | "daily" | "weekly"; enabled?: boolean;
    remotePath?: string; retentionCount?: number;
  },
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (patch.name !== undefined) { sets.push("name = ?"); values.push(patch.name); }
  if (patch.endpoint !== undefined) { sets.push("endpoint = ?"); values.push(patch.endpoint); }
  if (patch.bucket !== undefined) { sets.push("bucket = ?"); values.push(patch.bucket); }
  if (patch.username !== undefined) { sets.push("username = ?"); values.push(patch.username); }
  if (patch.secretCiphertext !== undefined) { sets.push("secret_ciphertext = ?"); values.push(patch.secretCiphertext); }
  if (patch.schedule !== undefined) { sets.push("schedule = ?"); values.push(patch.schedule); }
  if (patch.remotePath !== undefined) { sets.push("remote_path = ?"); values.push(patch.remotePath); }
  if (patch.retentionCount !== undefined) { sets.push("retention_count = ?"); values.push(patch.retentionCount); }
  if (patch.enabled !== undefined) { sets.push("enabled = ?"); values.push(patch.enabled ? 1 : 0); }
  if (sets.length === 0) return;
  values.push(userId, id);
  await db.prepare(`UPDATE backup_targets SET ${sets.join(", ")} WHERE user_id = ? AND id = ?`).bind(...values).run();
}

export async function recordTargetResult(db: SqlDatabase, userId: string, id: string, result: string, pushedAt: number | null = null): Promise<void> {
  await db.prepare("UPDATE backup_targets SET last_result = ?, last_pushed_at = COALESCE(?, last_pushed_at) WHERE user_id = ? AND id = ?")
    .bind(result.slice(0, 500), pushedAt, userId, id).run();
}

export async function deleteTarget(db: SqlDatabase, userId: string, id: string): Promise<void> {
  await db.prepare("DELETE FROM backup_targets WHERE id = ? AND user_id = ?").bind(id, userId).run();
}

/** 到期目标（调度默认值：daily 24h / weekly 7d；开放项 #9 定稿）。 */
export async function listDueTargets(db: SqlDatabase, now: number) {
  const rows = await db.prepare(
    "SELECT id, user_id, kind, endpoint, bucket, username, secret_ciphertext, schedule, last_pushed_at, last_result, remote_path, retention_count FROM backup_targets WHERE enabled = 1 AND schedule IN ('daily', 'weekly')",
  ).all<{ id: string; user_id: string; kind: string; endpoint: string | null; bucket: string | null; username: string | null; secret_ciphertext: string | null; schedule: string; last_pushed_at: number | null; last_result: string | null; remote_path: string; retention_count: number }>();
  const intervalMs = (schedule: string): number => (schedule === "weekly" ? 7 * 86_400_000 : 86_400_000);
  return rows.results
    .map((row) => ({ ...row, lastOkAt: row.last_pushed_at ?? parseLastOk(row.last_result) }))
    .filter((row) => now - (row.lastOkAt ?? 0) >= intervalMs(row.schedule));
}

function parseLastOk(lastResult: string | null): number | null {
  if (!lastResult?.startsWith("ok:")) return null;
  const match = lastResult.match(/^ok:(\d{4}-\d{2}-\d{2}T[^:]+:[^:]+:[^:]+)/);
  return match ? Date.parse(match[1]!) || null : null;
}

/** 备份收集（G9）：全部行读取在 db 层；分片组装与 manifest 在服务层（纯逻辑）。 */
export async function collectBackupRows(db: SqlDatabase, userId: string): Promise<{
  items: Record<string, unknown>[];
  topics: Record<string, unknown>[];
  itemKeyWraps: Record<string, unknown>[];
  memoComments: Record<string, unknown>[];
  topicKeyWraps: Record<string, unknown>[];
  settings: Record<string, unknown>[];
  clipTemplates: unknown[];
  raindrop: { bindings: Record<string, unknown>[]; rows: Record<string, unknown>[] };
  attachmentHashes: string[];
  attachmentObjects: Map<string, { key: string | null; mime: string }>;
  recoveryCodeBinding: ReturnType<typeof recoveryBindingFromRow>;
}> {
  // Read rows and their key wraps within one transaction so a concurrent sync can't split them.
  const [items, topics, itemKeyWraps, memoComments, topicKeyWraps, settings, attachmentRows, recoveryCode, templates, bindings, mappings] = await db.batch<Record<string, unknown>>([
    db.prepare("SELECT * FROM items WHERE user_id = ?").bind(userId),
    db.prepare("SELECT * FROM topic_nodes WHERE user_id = ?").bind(userId),
    db.prepare(`SELECT w.* FROM item_key_wraps w JOIN items i ON i.user_id = w.user_id AND i.id = w.item_id
      WHERE w.user_id = ? AND ((i.enc_self = 1 AND w.wrapper IN ('password', 'recovery')) OR (i.in_enc_space = 1 AND w.wrapper = 'topic'))`).bind(userId),
    db.prepare("SELECT * FROM memo_comments WHERE user_id = ?").bind(userId),
    db.prepare(`SELECT w.* FROM topic_key_wraps w JOIN topic_nodes t ON t.user_id = w.user_id AND t.id = w.topic_id
      WHERE w.user_id = ? AND t.is_enc_space = 1`).bind(userId),
    db.prepare("SELECT * FROM user_settings WHERE user_id = ?").bind(userId),
    db.prepare("SELECT sha256, mime, CASE WHEN retired_at IS NULL THEN COALESCE(r2_key, user_id || '/' || sha256) END AS key FROM attachments WHERE user_id = ?").bind(userId),
    recoveryCodeReadStatement(db, userId),
    db.prepare("SELECT template_json FROM clip_templates WHERE user_id = ? ORDER BY id").bind(userId),
    db.prepare("SELECT b.table_item_id, b.collection_id, b.pull_interval_hours FROM raindrop_bindings b JOIN items i ON i.user_id=b.user_id AND i.id=b.table_item_id AND i.type='table' WHERE b.user_id=?").bind(userId),
    db.prepare("SELECT menote_row_id, raindrop_id, baseline_json, baseline_hash, status, updated_at FROM raindrop_sync_rows WHERE user_id=? ORDER BY menote_row_id").bind(userId),
  ]);
  const hashes = new Set(attachmentRows!.results.filter(row => row.key !== null).map(row => String(row.sha256)));
  for (const item of items!.results) {
    // 快照包含回收站条目；它们的附件也必须一同保存，才能通过完整性校验并恢复。
    try {
      for (const hash of JSON.parse(String(item.attachment_hashes_json ?? "[]")) as string[]) hashes.add(hash);
    } catch { /* 忽略坏行。 */ }
  }
  return {
    clipTemplates: templates!.results.map(row => JSON.parse(String(row.template_json))),
    raindrop: { bindings: bindings!.results, rows: bindings!.results.length ? mappings!.results : [] },
    items: items!.results, topics: topics!.results, memoComments: memoComments!.results, itemKeyWraps: itemKeyWraps!.results,
    topicKeyWraps: topicKeyWraps!.results, settings: settings!.results, attachmentHashes: [...hashes],
    attachmentObjects: new Map(attachmentRows!.results.map((row) => [
      String(row.sha256), { key: typeof row.key === "string" ? row.key : null, mime: String(row.mime) },
    ])),
    recoveryCodeBinding: recoveryBindingFromRow(recoveryCode?.results[0]),
  };
}

/** 恢复设置：版本更旧则跳过。密文列只接受字节。 */
export function restoreSettingStatement(
  db: SqlDatabase, userId: string, row: Record<string, unknown>,
): SqlStatement | null {
  const key = String(row.key ?? "");
  if (!key) return null;
  const rev = Number(row.rev ?? 0);
  const secret = Number(row.is_secret) === 1;
  const valueJson = secret ? null : String(row.value_json ?? "null");
  const ciphertext = secret ? row.value_ciphertext : null;
  if (secret && !(ciphertext instanceof Uint8Array)) return null;
  return db.prepare(
    `INSERT INTO user_settings (user_id, key, is_secret, value_json, value_ciphertext, rev, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET is_secret = excluded.is_secret,
       value_json = excluded.value_json, value_ciphertext = excluded.value_ciphertext,
       rev = excluded.rev, updated_at = excluded.updated_at
     WHERE user_settings.rev <= excluded.rev`,
  ).bind(userId, key, secret ? 1 : 0, valueJson, ciphertext, rev, Number(row.updated_at ?? Date.now()));
}
