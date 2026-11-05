import {
  type AuthStatus, type AuthUser, type CredentialsInput,
  validPassword, validUsername,
} from "@menote/shared";
import {
  clearLoginThrottle as dbClearLoginThrottle, countUsers, createFirstOwner, createMember,
  createSession, deleteExpiredSessions, deleteSession, findCredential, findUserById,
  findUserByUsername, loginThrottled as dbLoginThrottled,
  readRegistration, readSession, recordLoginFailure as dbRecordLoginFailure,
  toAuthUser, touchSession, writeRegistration,
} from "../db/auth";
import { migrateSchema } from "./schemaService";

/** 认证端点依赖业务 schema；迁移就绪结果按 isolate 记忆，失败后可重试。 */
let schemaReadyCheck: Promise<boolean> | null = null;

export async function ensureSchemaReady(db: D1Database): Promise<boolean> {
  if (!schemaReadyCheck) {
    schemaReadyCheck = migrateSchema(db).then((status) => status === "ready")
      .catch(() => {
        schemaReadyCheck = null;
        return false;
      });
  }
  return schemaReadyCheck;
}

/**
 * G1 认证设计要点（详见管理线开发记录）：
 * - 口令哈希 = PBKDF2-HMAC-SHA256(口令, 盐, 迭代) 再经 HKDF(AUTH_PEPPER) 派生密钥做 HMAC 封口；
 *   仅凭数据库内容无法离线爆破（缺少 pepper），pepper 泄漏后退化为 PBKDF2 强度。
 * - 迭代次数受 Workers CPU 预算约束（免费档约 10ms/请求）：100k 实测约 64ms 超限，取 10k（实测见开发记录），
 *   以服务端高熵 pepper 弥补；次数随凭据存储，付费档可上调。
 * - 会话存 D1（可撤销），cookie HttpOnly + Secure + SameSite=Strict。
 */
export const PBKDF2_ITERATIONS = 10_000;
export const PBKDF2_ALGO = "PBKDF2-SHA256";
const HASH_BITS = 256;
const PEPPER_INFO = "menote/auth-pepper-v1";
export const SESSION_COOKIE = "mn_session";
export const SESSION_TTL_MS = 30 * 24 * 3_600_000;

export class AuthError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

export function pepperKeyMaterial(env: Env): string {
  const pepper: unknown = Reflect.get(env, "AUTH_PEPPER");
  if (typeof pepper !== "string" || pepper.trim().length === 0) {
    throw new AuthError(503, "auth_unconfigured");
  }
  return pepper;
}

const encoder = new TextEncoder();

async function pbkdf2Bits(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, HASH_BITS,
  );
  return new Uint8Array(bits);
}

async function hmacWithPepper(pepper: string, data: Uint8Array): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey("raw", encoder.encode(pepper), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: encoder.encode(PEPPER_INFO) },
    base, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, data as BufferSource);
  return new Uint8Array(mac);
}

export async function hashPassword(
  pepper: string, password: string, salt: Uint8Array, iterations: number,
): Promise<Uint8Array> {
  return hmacWithPepper(pepper, await pbkdf2Bits(password, salt, iterations));
}

/** 常数时间比较，防止逐字节计时侧信道。 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function randomToken(bytes: number): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function parseCredentials(body: unknown): CredentialsInput {
  if (typeof body !== "object" || body === null) throw new AuthError(400, "invalid_request");
  const { username, password } = body as Record<string, unknown>;
  if (!validUsername(username) || !validPassword(password)) throw new AuthError(400, "invalid_credentials");
  return { username, password };
}

/** 验证口令；失败抛 401（统一口径，不区分用户名是否存在）。 */
export async function verifyCredentials(
  env: Env, username: string, password: string,
): Promise<AuthUser> {
  const pepper = pepperKeyMaterial(env);
  const user = await findUserByUsername(env.DB, username);
  const credential = user ? await findCredential(env.DB, user.id) : null;
  const iterations = credential?.iterations ?? PBKDF2_ITERATIONS;
  const candidate = await hashPassword(pepper, password, credential?.salt ?? new Uint8Array(16), iterations);
  if (!user || !credential || credential.algo !== PBKDF2_ALGO
    || !timingSafeEqual(candidate, credential.hash)) {
    throw new AuthError(401, "invalid_login");
  }
  return toAuthUser(user);
}

export interface IssuedSession {
  userId: string;
  cookieValue: string;
  expiresAt: number;
}

async function sessionStorageId(cookieValue: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(cookieValue));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function issueSession(db: D1Database, userId: string, now: number): Promise<IssuedSession> {
  const cookieValue = randomToken(32);
  const expiresAt = now + SESSION_TTL_MS;
  await createSession(db, await sessionStorageId(cookieValue), userId, now, expiresAt);
  await deleteExpiredSessions(db, userId, now);
  return { userId, cookieValue, expiresAt };
}

export async function destroySession(db: D1Database, cookieValue: string): Promise<void> {
  await deleteSession(db, await sessionStorageId(cookieValue));
  await deleteSession(db, cookieValue);
}

/** 解析会话并滑动续期（剩余不足半周期时顺延）；无效返回 null。
 *  touch=false 供采样等只读归属使用，不产生写放大。
 *  库存的是 cookie 的 SHA-256。旧库里的明文 id 在首次访问时迁成摘要，不强制掉线。 */
export async function resolveSessionUser(
  db: D1Database, cookieValue: string, now: number, touch = true,
): Promise<AuthUser | null> {
  const hashed = await sessionStorageId(cookieValue);
  let session = await readSession(db, hashed);
  let storageId = hashed;
  if (!session) {
    const legacy = await readSession(db, cookieValue);
    if (legacy) {
      await createSession(db, hashed, legacy.userId, now, legacy.expiresAt);
      await deleteSession(db, cookieValue);
      session = { ...legacy, id: hashed };
      storageId = hashed;
    }
  }
  if (!session || session.expiresAt <= now) return null;
  const remaining = session.expiresAt - now;
  if (touch && remaining < SESSION_TTL_MS / 2) {
    const nextExpiry = now + SESSION_TTL_MS;
    await touchSession(db, storageId, nextExpiry, now);
  }
  const user = await findUserById(db, session.userId);
  return user ? toAuthUser(user) : null;
}

export async function authStatus(db: D1Database, user: AuthUser | null): Promise<AuthStatus> {
  if (user) return { phase: "ready", user, registrationOpen: false };
  if ((await countUsers(db)) === 0) return { phase: "bootstrap", user: null, registrationOpen: false };
  const registration = await readRegistration(db);
  return { phase: "login", user: null, registrationOpen: registration.open };
}

export async function bootstrapOwner(env: Env, input: CredentialsInput, now: number): Promise<AuthUser> {
  const pepper = pepperKeyMaterial(env);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(pepper, input.password, salt, PBKDF2_ITERATIONS);
  const user = { id: crypto.randomUUID(), username: input.username };
  const created = await createFirstOwner(env.DB, user, {
    algo: PBKDF2_ALGO, iterations: PBKDF2_ITERATIONS, salt, hash, now,
  });
  if (!created) throw new AuthError(409, "bootstrap_closed");
  return { id: user.id, username: user.username, role: "owner" };
}

export async function registerMember(env: Env, input: CredentialsInput, now: number): Promise<AuthUser> {
  const pepper = pepperKeyMaterial(env);
  if ((await countUsers(env.DB)) === 0) throw new AuthError(409, "bootstrap_required");
  const registration = await readRegistration(env.DB);
  if (!registration.open || (registration.openUntil !== null && registration.openUntil <= now)) {
    throw new AuthError(403, "registration_closed");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await hashPassword(pepper, input.password, salt, PBKDF2_ITERATIONS);
  const user = { id: crypto.randomUUID(), username: input.username, now };
  try {
    await createMember(env.DB, user, { algo: PBKDF2_ALGO, iterations: PBKDF2_ITERATIONS, salt, hash });
  } catch (error) {
    if (String(error).includes("UNIQUE")) throw new AuthError(409, "username_taken");
    throw error;
  }
  return { id: user.id, username: user.username, role: "member" };
}

/** owner 控制注册开关与有效期；非 owner 拒绝。 */
export async function setRegistration(
  env: Env, caller: AuthUser, open: boolean, openUntil: number | null, now: number,
): Promise<void> {
  if (caller.role !== "owner") throw new AuthError(403, "owner_only");
  if (openUntil !== null && (!Number.isSafeInteger(openUntil) || openUntil <= now)) {
    throw new AuthError(400, "invalid_open_until");
  }
  if (!(await writeRegistration(env.DB, open, openUntil, now))) throw new AuthError(409, "bootstrap_required");
}

/* 登录节流（负责人安全口径：内容为日常记录，按防无差别探查设计，体验优先）：
 * 第一层：单 isolate 全局洪峰守卫（纯内存，命中后不产生 D1 写，保护免费档写配额）；
 * 第二层：D1 持久按用户名计数（跨实例生效），达到上限后仅读判定，不再写放大。
 * 分布式放量攻击仍可能消耗 D1 写配额——超出本口径的防护属平台层（如 WAF 限速规则），不写代码。 */
const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_MAX_FAILURES = 10;
const FLOOD_WINDOW_MS = 60_000;
const FLOOD_MAX_FAILURES = 100;
const flood = { count: 0, resetAt: 0 };

function resetFloodWindow(now: number): void {
  flood.count = 0;
  flood.resetAt = now + FLOOD_WINDOW_MS;
}

/** 洪峰守卫：本 isolate 每分钟登录失败超过阈值时暂时拒绝全部登录（429），不再触碰 D1。 */
export function loginFloodGuard(now: number): boolean {
  if (flood.resetAt <= now) resetFloodWindow(now);
  return flood.count >= FLOOD_MAX_FAILURES;
}

export function noteLoginFailureFlood(now: number): void {
  if (flood.resetAt <= now) resetFloodWindow(now);
  flood.count += 1;
}

/** D1 持久节流判定；节流基础设施故障时放行（fail-open），如实记录。 */
export async function loginThrottled(db: D1Database, username: string, now: number): Promise<boolean> {
  try {
    return await dbLoginThrottled(db, username, now, LOGIN_MAX_FAILURES);
  } catch {
    return false;
  }
}

export async function recordLoginFailure(db: D1Database, username: string, now: number): Promise<void> {
  await dbRecordLoginFailure(db, username, now, LOGIN_WINDOW_MS).catch(() => {});
}

export async function clearLoginFailures(db: D1Database, username: string): Promise<void> {
  await dbClearLoginThrottle(db, username).catch(() => {});
}

function dbLoginThrottledLast(db: D1Database, username: string, now: number, maxFailures: number): Promise<boolean> {
  return dbLoginThrottledBottom(db, username, now, maxFailures);
}

function dbLoginThrottledBottom(db: D1Database, username: string, now: number, maxFailures: number): Promise<boolean> {
  return dbLoginThrottledRoot(db, username, now, maxFailures);
}

function dbLoginThrottledRoot(db: D1Database, username: string, now: number, maxFailures: number): Promise<boolean> {
  return dbLoginThrottled(db, username, now, maxFailures);
}
