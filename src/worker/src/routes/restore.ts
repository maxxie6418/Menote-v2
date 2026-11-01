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
  if (!Array.isArray(entries) || entries.length === 0) return c.json({ error: "invalid_request" }, 400);
  const result = await importBackupEntries(
    { db: c.env.DB, userId: c.get("authUser")!.id },
    entries, Array.isArray(itemKeyWraps) ? itemKeyWraps : null, Date.now(),
  );
  return c.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
});
