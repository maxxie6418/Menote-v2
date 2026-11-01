import { Hono } from "hono";
import type { AppEnv } from "../middleware/session";
import { requireSession, resolveSession, sameOriginGuard } from "../middleware/session";
import { requestSummary } from "../services/monitorService";
import { clearCloudflareConnection, readCloudflareConnection, readCloudflareMetrics, revealCloudflareToken, saveCloudflareConnection } from "../services/monitorCloudflareService";
import type { CloudflareMonitorSetup } from "@menote/shared";

/** G1 起监控面板需登录；数据本身仍为应用级估算统计（不含内容，聚合口径见开发记录）。 */
export const monitorRoutes = new Hono<AppEnv>();

function authPepper(env: AppEnv["Bindings"]): string | null {
  const value: unknown = Reflect.get(env, "AUTH_PEPPER");
  return typeof value === "string" && value.trim() ? value : null;
}

monitorRoutes.get("/api/monitor/cloudflare/config", resolveSession, requireSession, async (c) => {
  const user = c.get("authUser");
  if (!user) return c.json({ error: "unauthorized" }, 401);
  if (!authPepper(c.env)) return c.body(null, 503);
  try { return c.json(await readCloudflareConnection(c.env.DB, user.id), { headers: { "Cache-Control": "no-store" } }); }
  catch { return c.body(null, 503); }
});

monitorRoutes.post("/api/monitor/cloudflare/config", resolveSession, requireSession, sameOriginGuard, async (c) => {
  const user = c.get("authUser");
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const pepper = authPepper(c.env);
  if (!pepper) return c.body(null, 503);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_request" }, 400); }
  if (!body || typeof body !== "object") return c.json({ error: "invalid_request" }, 400);
  const input = body as Partial<CloudflareMonitorSetup>;
  if (typeof input.accountId !== "string" || typeof input.apiToken !== "string" || typeof input.scriptName !== "string" ||
      typeof input.d1DatabaseId !== "string" || typeof input.r2BucketName !== "string") return c.json({ error: "invalid_request" }, 400);
  try {
    await saveCloudflareConnection(c.env.DB, user.id, pepper, input as CloudflareMonitorSetup, Date.now());
    return c.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message.slice(0, 220) : "Cloudflare Analytics API 验证失败" }, 400);
  }
});

monitorRoutes.delete("/api/monitor/cloudflare/config", resolveSession, requireSession, sameOriginGuard, async (c) => {
  const user = c.get("authUser");
  if (!user) return c.json({ error: "unauthorized" }, 401);
  if (!authPepper(c.env)) return c.body(null, 503);
  try { await clearCloudflareConnection(c.env.DB, user.id); return c.json({ ok: true }); }
  catch { return c.body(null, 503); }
});

monitorRoutes.get("/api/monitor/cloudflare/token", resolveSession, requireSession, async (c) => {
  const user = c.get("authUser");
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const pepper = authPepper(c.env);
  if (!pepper) return c.body(null, 503);
  try {
    const token = await revealCloudflareToken(c.env.DB, user.id, pepper);
    return token ? c.json({ token }, { headers: { "Cache-Control": "no-store, private" } }) : c.body(null, 404);
  } catch { return c.body(null, 503); }
});

monitorRoutes.get("/api/monitor/cloudflare/metrics", resolveSession, requireSession, async (c) => {
  const user = c.get("authUser");
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const pepper = authPepper(c.env);
  if (!pepper) return c.body(null, 503);
  const period = c.req.query("period") ?? "utc_day";
  if (period !== "utc_day" && period !== "utc_month") return c.body(null, 400);
  try {
    const metrics = await readCloudflareMetrics(c.env.DB, user.id, pepper, period, Date.now());
    return c.json({ metrics }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return c.json({ error: "Cloudflare Analytics API 暂不可用，请核对 Token 权限和资源标识" }, 502);
  }
});

monitorRoutes.all("/api/monitor", resolveSession, async (c) => {
  if (c.req.method !== "GET") return c.body(null, 405, { Allow: "GET" });
  if (!c.get("authUser")) return c.json({ error: "unauthorized" }, 401);
  const pepper: unknown = Reflect.get(c.env, "AUTH_PEPPER");
  if (typeof pepper !== "string" || !pepper.trim() || !c.env.DB) return c.body(null, 503);
  const period = c.req.query("period") ?? "utc_day";
  if (period !== "utc_day" && period !== "utc_month") return c.body(null, 400);
  try {
    return c.json(await requestSummary(c.env.DB, Date.now(), period),
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    return c.body(null, 503);
  }
});
