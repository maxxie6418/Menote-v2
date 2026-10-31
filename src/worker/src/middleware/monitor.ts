import { sessionCookieFrom } from "./session";
import { resolveSessionUser } from "../services/authService";
import { sampleRequest } from "../services/monitorService";

/** Monitoring must never change the result of the underlying request.
 *  G1 起：能解析出会话时样本归属该用户，否则保留安装级范围。 */
export function observeRequest(env: Env, ctx: ExecutionContext, request: Request): void {
  const pepper: unknown = Reflect.get(env, "AUTH_PEPPER");
  if (typeof pepper !== "string" || !pepper.trim() || !env.DB) return;
  ctx.waitUntil((async () => {
    let userId: string | undefined;
    const cookie = sessionCookieFrom(request);
    if (cookie) {
      try {
        userId = (await resolveSessionUser(env.DB, cookie, Date.now(), false))?.id;
      } catch { /* 归属失败不影响采样。 */ }
    }
    await sampleRequest(env.DB, undefined, undefined, userId);
  })().catch(() => {}));
}
