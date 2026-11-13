

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

export async function listTargets(db: D1Database, userId: string) {
  const rows = await db.prepare(
    "SELECT id, user_id, kind, endpoint, bucket, username, secret_ciphertext, delete_policy, schedule, enabled, name, remote_path, retention_count, last_pushed_at, last_result FROM backup_targets WHERE user_id = ? ORDER BY id",
  ).bind(userId).all<TargetRow>();
  return rows.results.map(toTarget);
}

export async function getTarget(db: D1Database, userId: string, id: string) {
  const row = await db.prepare(
    "SELECT id, user_id, kind, endpoint, bucket, username, secret_ciphertext, delete_policy, schedule, enabled, name, remote_path, retention_count, last_pushed_at, last_result FROM backup_targets WHERE id = ? AND user_id = ?",
  ).bind(id, userId).first<TargetRow>();
  return row ? toTarget(row) : null;
}

export async function createTarget(
  db: D1Database, userId: string, input: {
    kind: "s3" | "webdav"; endpoint: string; bucket: string | null; username: string | null;
    secretCiphertext: string; deletePolicy: "append_only" | "sync"; schedule: "manual" | "daily" | "weekly"; name: string;
    remotePath?: string; retentionCount?: number;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO backup_targets (id, user_id, kind, endpoint, bucket, username, secret_ciphertext, delete_policy, schedule, enabled, name, remote_path, retention_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  ).bind(id, userId, input.kind, input.endpoint, input.bucket, input.username, input.secretCiphertext, input.deletePolicy, input.schedule, input.name, input.remotePath ?? "menote", input.retentionCount ?? 0).run();
  return id;
}

export async function updateTarget(
  db: D1Database, userId: string, id: string, patch: {
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

export async function recordTargetResult(db: D1Database, userId: string, id: string, result: string, pushedAt: number | null = null): Promise<void> {
  await db.prepare("UPDATE backup_targets SET last_result = ?, last_pushed_at = COALESCE(?, last_pushed_at) WHERE user_id = ? AND id = ?")
    .bind(result.slice(0, 500), pushedAt, userId, id).run();
}

export async function deleteTarget(db: D1Database, userId: string, id: string): Promise<void> {
  await db.prepare("DELETE FROM backup_targets WHERE id = ? AND user_id = ?").bind(id, userId).run();
}

/** 到期目标（调度默认值：daily 24h / weekly 7d；开放项 #9 定稿）。 */
export async function listDueTargets(db: D1Database, now: number) {
  const rows = await db.prepare(
    "SELECT id, user_id, kind, endpoint, bucket, username, secret_ciphertext, schedule, last_result, remote_path, retention_count FROM backup_targets WHERE enabled = 1 AND schedule IN ('daily', 'weekly')",
  ).all<{ id: string; user_id: string; kind: string; endpoint: string | null; bucket: string | null; username: string | null; secret_ciphertext: string | null; schedule: string; last_result: string | null; remote_path: string; retention_count: number }>();
  const intervalMs = (schedule: string): number => (schedule === "weekly" ? 7 * 86_400_000 : 86_400_000);
  return rows.results
    .map((row) => ({ ...row, lastOkAt: parseLastOk(row.last_result) }))
    .filter((row) => now - (row.lastOkAt ?? 0) >= intervalMs(row.schedule));
}

function parseLastOk(lastResult: string | null): number | null {
  if (!lastResult?.startsWith("ok:")) return null;
  const match = lastResult.match(/^ok:(\d{4}-\d{2}-\d{2}T[^:]+:[^:]+:[^:]+)/);
  return match ? Date.parse(match[1]!) || null : null;
}

/** 备份收集（G9）：全部行读取在 db 层；分片组装与 manifest 在服务层（纯逻辑）。 */
export async function collectBackupRows(db: D1Database, userId: string): Promise<{
  items: Record<string, unknown>[];
  topics: Record<string, unknown>[];
  itemKeyWraps: Record<string, unknown>[];
  memoComments: Record<string, unknown>[];
  topicKeyWraps: Record<string, unknown>[];
  settings: Record<string, unknown>[];
  attachmentHashes: string[];
}> {
  const items = await db.prepare("SELECT * FROM items WHERE user_id = ?").bind(userId).all<Record<string, unknown>>();
  const topics = await db.prepare("SELECT * FROM topic_nodes WHERE user_id = ?").bind(userId).all<Record<string, unknown>>();
  const itemKeyWraps = await db.prepare("SELECT * FROM item_key_wraps WHERE user_id = ?").bind(userId).all<Record<string, unknown>>();
  const memoComments = await db.prepare("SELECT * FROM memo_comments WHERE user_id = ?").bind(userId).all<Record<string, unknown>>();
  const topicKeyWraps = await db.prepare("SELECT * FROM topic_key_wraps WHERE user_id = ?").bind(userId).all<Record<string, unknown>>();
  const settings = await db.prepare("SELECT * FROM user_settings WHERE user_id = ?").bind(userId).all<Record<string, unknown>>();
  const hashes = new Set<string>();
  for (const item of items.results) {
    try {
      for (const hash of JSON.parse(String(item.attachment_hashes_json ?? "[]")) as string[]) hashes.add(hash);
    } catch { /* 忽略坏行。 */ }
  }
  return {
    items: items.results, topics: topics.results, memoComments: memoComments.results, itemKeyWraps: itemKeyWraps.results,
    topicKeyWraps: topicKeyWraps.results, settings: settings.results, attachmentHashes: [...hashes],
  };
}

/** 恢复设置：rev 不高于本地则跳过。密文列只接受字节。 */
export function restoreSettingStatement(
  db: D1Database, userId: string, row: Record<string, unknown>,
): D1PreparedStatement | null {
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

export async function readSettingRev(db: D1Database, userId: string, key: string): Promise<number | null> {
  const row = await db.prepare("SELECT rev FROM user_settings WHERE user_id = ? AND key = ?")
    .bind(userId, key).first<{ rev: number }>();
  return row?.rev ?? null;
}
