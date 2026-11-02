import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AiTaskKind } from "@menote/shared";
import type { AppEnv } from "../middleware/session";
import { requireSession, resolveSession, sameOriginGuard } from "../middleware/session";
import { ensureSchemaReady } from "../services/authService";
import { AiServiceError, readAiTaskView, readAiUsageSummary, submitAiTask } from "../services/aiService";

/** AI 助手端点（FR-AI-2）：任务提交/查询与用量；设置本身走 user_settings 同步，不经 REST。 */
export const aiRoutes = new Hono<AppEnv>();

aiRoutes.use("/api/ai/*", resolveSession);

aiRoutes.post("/api/ai/tasks", requireSession, sameOriginGuard, async (c) => {
  if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_request" }, 400);
  const input = body as Record<string, unknown>;
  if (typeof input.itemId !== "string" || typeof input.content !== "string"
    || (typeof input.kind !== "string") || (input.kind !== "summary" && input.kind !== "tags")) {
    return c.json({ error: "invalid_request" }, 400);
  }
  try {
    const task = await submitAiTask(c.env, c.get("authUser")!.id, {
      itemId: input.itemId, kind: input.kind as AiTaskKind,
      title: typeof input.title === "string" ? input.title : "",
      tags: Array.isArray(input.tags) ? input.tags as string[] : [],
      content: input.content, force: input.force === true,
    }, Date.now());
    return c.json({ task }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AiServiceError) return c.json({ error: error.message }, error.status as ContentfulStatusCode);
    return c.json({ error: "AI 任务提交失败" }, 500);
  }
});

aiRoutes.get("/api/ai/tasks/:id", requireSession, async (c) => {
  if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
  const task = await readAiTaskView(c.env.DB, c.get("authUser")!.id, c.req.param("id"));
  return task ? c.json({ task }, { headers: { "Cache-Control": "no-store" } }) : c.json({ error: "not_found" }, 404);
});

aiRoutes.get("/api/ai/usage", requireSession, async (c) => {
  if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
  const usage = await readAiUsageSummary(c.env.DB, c.get("authUser")!.id, Date.now());
  return c.json({ usage }, { headers: { "Cache-Control": "no-store" } });
});
