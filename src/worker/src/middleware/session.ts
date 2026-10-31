import type { AuthUser } from "@menote/shared";
import { getCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";
import { SESSION_COOKIE, resolveSessionUser } from "../services/authService";

export type AppEnv = { Bindings: Env; Variables: { authUser?: AuthUser } };

/** 尽力解析会话（不阻断公开路由；数据库异常按未登录处理）。 */
export const resolveSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const cookie = getCookie(c, SESSION_COOKIE);
  if (cookie) {
    try {
      const user = await resolveSessionUser(c.env.DB, cookie, Date.now());
      if (user) c.set("authUser", user);
    } catch { /* 公开路由不受会话解析失败影响。 */ }
  }
  await next();
};

/** 受保护路由的守卫：未登录统一 401，不泄露任何内部细节。 */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("authUser");
  if (!user) return c.json({ error: "unauthorized" }, 401);
  await next();
};

/** CSRF 纵深防御：变更请求若携带 Origin，必须与站点同源（SameSite=Strict 之外的兜底）。 */
export const sameOriginGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) return next();
  const origin = c.req.header("Origin");
  if (origin) {
    const url = new URL(c.req.url);
    if (origin !== `${url.protocol}//${url.host}`) return c.json({ error: "cross_origin" }, 403);
  }
  return next();
};

/** 供非 Hono 路径（如请求采样）读取会话归属。 */
export function sessionCookieFrom(request: Request): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return null;
}

export function currentOrigin(c: Context<AppEnv>): string {
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}`;
}
