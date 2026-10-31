import { Hono } from "hono";
import type { AppEnv } from "../middleware/session";
import { requireSession, resolveSession } from "../middleware/session";
import { requestSummary } from "../services/monitorService";

/** G1 起监控面板需登录；数据本身仍为应用级估算统计（不含内容，聚合口径见开发记录）。 */
export const monitorRoutes = new Hono<AppEnv>();

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
