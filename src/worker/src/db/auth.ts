import type { AuthUser } from "@menote/shared";

/** 认证相关全部 SQL（users / user_credentials / sessions / app_settings）。 */

export interface CredentialRow {
  userId: string;
  algo: string;
  iterations: number;
  salt: Uint8Array;
  hash: Uint8Array;
}

/** 不同运行时对 BLOB 的反序列化不一（Uint8Array/ArrayBuffer/数组），统一为 Uint8Array。 */
function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return new Uint8Array(value);
  throw new Error("Unexpected credential blob encoding");
}

export function toAuthUser(row: { id: string; username: string; role: string }): AuthUser {
  return { id: row.id, username: row.username, role: row.role === "owner" ? "owner" : "member" };
}

export async function countUsers(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  return row?.n ?? 0;
}

/** 零用户时原子创建 owner：users/credentials/默认设置在同一个 D1 batch 事务内。
 *  凭据与设置以「本批插入的用户行存在（EXISTS id）」为守卫，并发抢注只有 insertUser
 *  的唯一赢家会连带写入，输家的三条语句全部插零行且不触发主键冲突。 */
export async function createFirstOwner(
  db: D1Database,
  user: { id: string; username: string },
  credential: { algo: string; iterations: number; salt: Uint8Array; hash: Uint8Array; now: number },
): Promise<boolean> {
  const insertUser = db.prepare(
    `INSERT INTO users (id, username, role, created_at)
     SELECT ?, ?, 'owner', ? WHERE (SELECT COUNT(*) FROM users) = 0`,
  ).bind(user.id, user.username, credential.now);
  const insertCredential = db.prepare(
    `INSERT INTO user_credentials (user_id, algo, iterations, salt, hash, updated_at)
     SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)`,
  ).bind(user.id, credential.algo, credential.iterations, credential.salt, credential.hash, credential.now, user.id);
  const insertSettings = db.prepare(
    `INSERT INTO app_settings (key, value_json)
     SELECT 'registration', ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)`,
  ).bind(JSON.stringify({ open: false, openUntil: null }), user.id);
  const results = await db.batch([insertUser, insertCredential, insertSettings]);
  return (results[0].meta.changes ?? 0) === 1;
}

export async function findUserByUsername(db: D1Database, username: string) {
  return db.prepare("SELECT id, username, role FROM users WHERE username = ?")
    .bind(username).first<{ id: string; username: string; role: string }>();
}

export async function findUserById(db: D1Database, userId: string) {
  return db.prepare("SELECT id, username, role FROM users WHERE id = ?")
    .bind(userId).first<{ id: string; username: string; role: string }>();
}

export async function findCredential(db: D1Database, userId: string): Promise<CredentialRow | null> {
  const row = await db.prepare(
    "SELECT user_id, algo, iterations, salt, hash FROM user_credentials WHERE user_id = ?",
  ).bind(userId).first<{ user_id: string; algo: string; iterations: number; salt: unknown; hash: unknown }>();
  return row ? {
    userId: row.user_id, algo: row.algo, iterations: row.iterations,
    salt: toBytes(row.salt), hash: toBytes(row.hash),
  } : null;
}

/** 注册开关与有效期（owner 控制）。缺失视为关闭。 */
export async function readRegistration(db: D1Database): Promise<{ open: boolean; openUntil: number | null }> {
  const row = await db.prepare("SELECT value_json FROM app_settings WHERE key = 'registration'").first<{
    value_json: string;
  }>();
  if (!row) return { open: false, openUntil: null };
  try {
    const parsed: unknown = JSON.parse(row.value_json);
    if (typeof parsed === "object" && parsed !== null) {
      const open = (parsed as { open?: unknown }).open === true;
      const openUntil = (parsed as { openUntil?: unknown }).openUntil;
      return { open, openUntil: typeof openUntil === "number" && Number.isFinite(openUntil) ? openUntil : null };
    }
  } catch { /* 损坏的设置按关闭处理。 */ }
  return { open: false, openUntil: null };
}

/** owner 开启注册：写入开关与有效期。库中无 owner（bootstrap 未完成）时拒绝。 */
export async function writeRegistration(
  db: D1Database, open: boolean, openUntil: number | null, now: number,
): Promise<boolean> {
  if ((await countUsers(db)) === 0) return false;
  await db.prepare(
    `INSERT INTO app_settings (key, value_json) VALUES ('registration', ?)
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
  ).bind(JSON.stringify({ open, openUntil })).run();
  void now;
  return true;
}

/** 注册开放时创建 member 用户；users.username UNIQUE 冲突向上抛出。 */
export async function createMember(
  db: D1Database,
  user: { id: string; username: string; now: number },
  credential: { algo: string; iterations: number; salt: Uint8Array; hash: Uint8Array },
): Promise<void> {
  await db.batch([
    db.prepare("INSERT INTO users (id, username, role, created_at) VALUES (?, ?, 'member', ?)")
      .bind(user.id, user.username, user.now),
    db.prepare(
      "INSERT INTO user_credentials (user_id, algo, iterations, salt, hash, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(user.id, credential.algo, credential.iterations, credential.salt, credential.hash, user.now),
  ]);
}

export async function createSession(
  db: D1Database, id: string, userId: string, now: number, expiresAt: number,
): Promise<void> {
  await db.prepare(
    "INSERT INTO sessions (id, user_id, created_at, expires_at, last_active_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(id, userId, now, expiresAt, now).run();
}

export interface SessionRow {
  id: string;
  userId: string;
  expiresAt: number;
  lastActiveAt: number;
}

export async function readSession(db: D1Database, id: string): Promise<SessionRow | null> {
  const row = await db.prepare(
    "SELECT id, user_id, expires_at, last_active_at FROM sessions WHERE id = ?",
  ).bind(id).first<{ id: string; user_id: string; expires_at: number; last_active_at: number }>();
  return row
    ? { id: row.id, userId: row.user_id, expiresAt: row.expires_at, lastActiveAt: row.last_active_at }
    : null;
}

/** 滑动续期：距到期超过一半周期时顺延，避免每请求一次写。 */
export async function touchSession(db: D1Database, id: string, expiresAt: number, now: number): Promise<void> {
  await db.prepare("UPDATE sessions SET expires_at = ?, last_active_at = ? WHERE id = ?")
    .bind(expiresAt, now, id).run();
}

export async function deleteSession(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
}

/** 登录成功后清理同用户过期会话，抑制垃圾行。 */
export async function deleteExpiredSessions(db: D1Database, userId: string, now: number): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?").bind(userId, now).run();
}

/** 登录失败节流（持久，跨实例生效）。达到上限后仅读判定，不再产生写放大。 */
export async function loginThrottled(db: D1Database, username: string, now: number, maxFailures: number): Promise<boolean> {
  const row = await db.prepare("SELECT failures, window_until FROM login_throttle WHERE username = ?")
    .bind(username).first<{ failures: number; window_until: number }>();
  return row !== null && row.window_until > now && row.failures >= maxFailures;
}

/** 记录一次失败：窗口内累加，窗口过期则重开新窗口。 */
export async function recordLoginFailure(db: D1Database, username: string, now: number, windowMs: number): Promise<void> {
  await db.prepare(
    `INSERT INTO login_throttle (username, failures, window_until) VALUES (?, 1, ?)
     ON CONFLICT (username) DO UPDATE SET
       failures = CASE WHEN window_until <= ? THEN 1 ELSE failures + 1 END,
       window_until = CASE WHEN window_until <= ? THEN ? ELSE window_until END`,
  ).bind(username, now + windowMs, now, now, now + windowMs).run();
}

export async function clearLoginThrottle(db: D1Database, username: string): Promise<void> {
  await db.prepare("DELETE FROM login_throttle WHERE username = ?").bind(username).run();
}
