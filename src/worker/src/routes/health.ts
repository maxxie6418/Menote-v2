import type { HealthResponse } from "@menote/shared";
import { Hono } from "hono";
import type { AppEnv } from "../middleware/session";
import { readiness } from "../services/healthService";

/** 存活与就绪：公开端点（部署验证依赖）；响应不携带任何基础设施诊断。 */
export const healthRoutes = new Hono<AppEnv>();

healthRoutes.get("/api/health/live", (c) =>
  c.json({ status: "alive" } satisfies HealthResponse));

healthRoutes.all("/api/health/ready", async (c) => {
  if (c.req.method !== "GET") return c.body(null, 405, { Allow: "GET" });
  const result = await readiness(c.env);
  return c.json(result, { status: result.status === "ready" ? 200 : 503,
    headers: { "Cache-Control": "no-store" } });
});
