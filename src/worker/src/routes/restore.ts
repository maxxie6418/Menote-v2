import { Hono } from "hono";
import type { AppEnv } from "../middleware/session";
import { requireSession, resolveSession, sameOriginGuard } from "../middleware/session";
import { ensureSchemaReady } from "../services/authService";
import { importBackupEntries } from "../services/restoreService";

/** 恢复导入路由（FR-BAK-9 工具侧）：合并逻辑在 restoreService（rev 高者胜）。 */
export const restoreRoutes = new Hono<AppEnv>();

restoreRoutes.post("/api/restore", resolveSession, sameOriginGuard, requireSession, async (c) => {
  if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
  const body: unknown = await c.req.json().catch(() => null);
  const entries = (body as { entries?: unknown } | null)?.entries;
  const itemKeyWraps = (body as { itemKeyWraps?: unknown } | null)?.itemKeyWraps;
  const topicKeyWraps = (body as { topicKeyWraps?: unknown } | null)?.topicKeyWraps;
  const settings = (body as { settings?: unknown } | null)?.settings;
  if (!Array.isArray(entries) || entries.length === 0) return c.json({ error: "invalid_request" }, 400);
  try {
    const result = await importBackupEntries(
      { db: c.env.DB, userId: c.get("authUser")!.id },
      entries,
      Array.isArray(itemKeyWraps) ? itemKeyWraps : null,
      Array.isArray(topicKeyWraps) ? topicKeyWraps : null,
      Array.isArray(settings) ? settings : null,
      Date.now(),
    );
    return c.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error && error.message.startsWith("invalid_") ? error.message : "invalid_backup";
    return c.json({ error: code }, 400);
  }
});
