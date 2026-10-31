import type { AuthUser } from "@menote/shared";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv } from "../middleware/session";
import { requireSession, resolveSession, sameOriginGuard } from "../middleware/session";
import {
  AuthError, SESSION_COOKIE, SESSION_TTL_MS, authStatus, bootstrapOwner, clearLoginFailures,
  destroySession, ensureSchemaReady, issueSession, loginFloodGuard, loginThrottled, noteLoginFailureFlood,
  parseCredentials, recordLoginFailure, registerMember, setRegistration, verifyCredentials,
} from "../services/authService";

function setSessionCookie(c: Context<AppEnv>, value: string): void {
  setCookie(c, SESSION_COOKIE, value, {
    httpOnly: true, secure: true, sameSite: "Strict", path: "/", maxAge: SESSION_TTL_MS / 1000,
  });
}

/** 认证端点：数据库或配置不可用时统一 503，不区分内部原因。 */
function authGuard(handler: (c: Context<AppEnv>) => Promise<Response>) {
  return async (c: Context<AppEnv>): Promise<Response> => {
    try {
      if (!(await ensureSchemaReady(c.env.DB))) throw new AuthError(503, "auth_unconfigured");
      return await handler(c);
    } catch (error) {
      if (error instanceof AuthError) return c.json({ error: error.code }, error.status as 400 | 401 | 403 | 409 | 429 | 503);
      return c.json({ error: "unavailable" }, 503);
    }
  };
}

export const authRoutes = new Hono<AppEnv>();

/** 阶段探测：公开端点；ready 阶段附带当前用户。 */
authRoutes.get("/api/auth/status", resolveSession, authGuard(async (c) => {
  const status = await authStatus(c.env.DB, c.get("authUser") ?? null);
  return c.json(status, { headers: { "Cache-Control": "no-store" } });
}));

/** 初始化引导：仅在库中零用户时成功（原子事务，并发抢注只有一个赢家）。 */
authRoutes.post("/api/auth/bootstrap", sameOriginGuard, authGuard(async (c) => {
  const input = parseCredentials(await c.req.json().catch(() => null));
  const user = await bootstrapOwner(c.env, input, Date.now());
  const session = await issueSession(c.env.DB, user.id, Date.now());
  setSessionCookie(c, session.cookieValue);
  return c.json({ user }, 201);
}));

/** 注册：仅 owner 开放注册且在有效期内时可用；新账号为 member。 */
authRoutes.post("/api/auth/register", sameOriginGuard, authGuard(async (c) => {
  const input = parseCredentials(await c.req.json().catch(() => null));
  const user = await registerMember(c.env, input, Date.now());
  const session = await issueSession(c.env.DB, user.id, Date.now());
  setSessionCookie(c, session.cookieValue);
  return c.json({ user }, 201);
}));

/** 登录：失败统一 401 防用户名枚举；洪峰守卫（内存）+ D1 持久按用户名节流。 */
authRoutes.post("/api/auth/login", sameOriginGuard, authGuard(async (c) => {
  const input = parseCredentials(await c.req.json().catch(() => null));
  const now = Date.now();
  if (loginFloodGuard(now) || (await loginThrottled(c.env.DB, input.username, now))) {
    throw new AuthError(429, "too_many_attempts");
  }
  try {
    const user = await verifyCredentials(c.env, input.username, input.password);
    await clearLoginFailures(c.env.DB, input.username);
    const session = await issueSession(c.env.DB, user.id, now);
    setSessionCookie(c, session.cookieValue);
    return c.json({ user });
  } catch (error) {
    if (error instanceof AuthError && error.status === 401) {
      noteLoginFailureFlood(now);
      await recordLoginFailure(c.env.DB, input.username, now);
    }
    throw error;
  }
}));

authRoutes.post("/api/auth/logout", resolveSession, sameOriginGuard, requireSession, authGuard(async (c) => {
  const cookie = getCookie(c, SESSION_COOKIE);
  if (cookie) await destroySession(c.env.DB, cookie);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
}));

authRoutes.get("/api/auth/me", resolveSession, authGuard(async (c) => {
  const user = c.get("authUser");
  if (!user) return c.json({ error: "unauthorized" }, 401);
  return c.json({ user }, { headers: { "Cache-Control": "no-store" } });
}));

/** owner 控制注册开关与有效期（开放项 #13 的管理 UI 待定，先落 API）。 */
authRoutes.post("/api/auth/registration", resolveSession, sameOriginGuard, requireSession, authGuard(async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (typeof body !== "object" || body === null) throw new AuthError(400, "invalid_request");
  const open = (body as { open?: unknown }).open === true;
  const rawUntil = (body as { openUntil?: unknown }).openUntil;
  const openUntil = typeof rawUntil === "number" ? rawUntil : null;
  await setRegistration(c.env, c.get("authUser") as AuthUser, open, openUntil, Date.now());
  return c.json({ ok: true });
}));
