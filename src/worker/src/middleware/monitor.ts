import { sampleRequest } from "../services/monitorService";

/** Monitoring must never change the result of the underlying request. */
export function observeRequest(env: Env, ctx: ExecutionContext): void {
  const pepper: unknown = Reflect.get(env, "AUTH_PEPPER");
  if (typeof pepper !== "string" || !pepper.trim() || !env.DB) return;
  ctx.waitUntil(sampleRequest(env.DB).catch(() => {}));
}
