import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { RAINDROP_INTERVAL_HOURS, resolveItemId } from "@menote/shared";
import type { AppEnv } from "../middleware/session";
import { requireSession, resolveSession, sameOriginGuard } from "../middleware/session";
import { ensureSchemaReady } from "../services/authService";
import { RaindropServiceError, bindTable, clearToken, previewPush, readStatus, runPull, runPush, saveToken, unbindTable } from "../services/raindropService";

/** Raindrop 连接器端点（FR-EXT-3，TP9）：状态/令牌/绑定/手动拉取；插件开关本身随 user_settings 同步不经 REST。 */
export const raindropRoutes = new Hono<AppEnv>();

raindropRoutes.use("/api/raindrop/*", resolveSession);

raindropRoutes.get("/api/raindrop/status", requireSession, async (c) => {
  if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
  const status = await readStatus(c.env.DB, c.get("authUser")!.id);
  return c.json({ status }, { headers: { "Cache-Control": "no-store" } });
});

raindropRoutes.put("/api/raindrop/token", requireSession, sameOriginGuard, async (c) => {
  if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
  const body: unknown = await c.req.json().catch(() => null);
  const token = typeof (body as Record<string, unknown> | null)?.token === "string"
    ? (body as { token: string }).token.trim() : "";
  if (!token || token.length > 512) return c.json({ error: "invalid_request" }, 400);
  try {
    await saveToken(c.env, c.get("authUser")!.id, token);
    return c.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RaindropServiceError) return c.json({ error: error.message }, error.status as ContentfulStatusCode);
    return c.json({ error: "令牌保存失败" }, 500);
  }
});

raindropRoutes.delete("/api/raindrop/token", requireSession, sameOriginGuard, async (c) => {
  if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
  await clearToken(c.env.DB, c.get("authUser")!.id);
  return c.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
});

raindropRoutes.post("/api/raindrop/bind", requireSession, sameOriginGuard, async (c) => {
  if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
  const body: unknown = await c.req.json().catch(() => null);
  const input = (body ?? {}) as Record<string, unknown>;
  const tableItemId = resolveItemId(typeof input.tableItemId === "string" ? input.tableItemId : "");
  const collectionId = input.collectionId;
  if (!tableItemId || tableItemId.length > 128 || typeof collectionId !== "number" || !Number.isInteger(collectionId)
    || collectionId < 0 || !RAINDROP_INTERVAL_HOURS.includes(input.pullIntervalHours as 1 | 6 | 24)) {
    return c.json({ error: "invalid_request" }, 400);
  }
  try {
    const binding = await bindTable(c.env, c.get("authUser")!.id, {
      tableItemId, collectionId, pullIntervalHours: input.pullIntervalHours as 1 | 6 | 24,
    });
    return c.json({ binding }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RaindropServiceError) return c.json({ error: error.message }, error.status as ContentfulStatusCode);
    return c.json({ error: "绑定失败" }, 500);
  }
});

raindropRoutes.post("/api/raindrop/unbind", requireSession, sameOriginGuard, async (c) => {
  if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
  await unbindTable(c.env.DB, c.get("authUser")!.id);
  return c.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
});

raindropRoutes.post("/api/raindrop/pull", requireSession, sameOriginGuard, async (c) => {
  if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
  try {
    const outcome = await runPull(c.env, c.get("authUser")!.id, "manual");
    return c.json({ outcome }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RaindropServiceError) return c.json({ error: error.message }, error.status as ContentfulStatusCode);
    return c.json({ error: "拉取失败" }, 500);
  }
});

raindropRoutes.post("/api/raindrop/push/preview", requireSession, sameOriginGuard, async (c) => {
  if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
  try {
    const preview = await previewPush(c.env, c.get("authUser")!.id);
    return c.json({ preview }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RaindropServiceError) return c.json({ error: error.message }, error.status as ContentfulStatusCode);
    return c.json({ error: "预览失败" }, 500);
  }
});

raindropRoutes.post("/api/raindrop/push", requireSession, sameOriginGuard, async (c) => {
  if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
  const body: unknown = await c.req.json().catch(() => null);
  try {
    const outcome = await runPush(c.env, c.get("authUser")!.id, { confirm: (body as Record<string, unknown> | null)?.confirm === true });
    return c.json({ outcome }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RaindropServiceError) return c.json({ error: error.message }, error.status as ContentfulStatusCode);
    return c.json({ error: "推送失败" }, 500);
  }
});
