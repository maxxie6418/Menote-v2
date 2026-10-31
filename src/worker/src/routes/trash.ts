import { Hono } from "hono";
import type { AppEnv } from "../middleware/session";
import { requireSession, resolveSession, sameOriginGuard } from "../middleware/session";
import { deleteItemWraps } from "../db/keyWraps";
import { ensureSchemaReady } from "../services/authService";

/** 回收站永久删除（G8，FR-VER-6）：仅已软删行；墓碑在软删时已传播；包装块随行清除。 */
export const trashRoutes = new Hono<AppEnv>();

trashRoutes.post("/api/trash/purge", resolveSession, sameOriginGuard, requireSession, async (c) => {
  if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
  const body: unknown = await c.req.json().catch(() => null);
  const ids = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200 || !ids.every((id) => typeof id === "string")) {
    return c.json({ error: "invalid_request" }, 400);
  }
  const userId = c.get("authUser")!.id;
  let purged = 0;
  for (const id of ids as string[]) {
    const result = await c.env.DB.prepare(
      "DELETE FROM items WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL",
    ).bind(id, userId).run();
    if ((result.meta.changes ?? 0) > 0) {
      await deleteItemWraps(c.env.DB, userId, id);
      purged += 1;
    }
  }
  return c.json({ purged }, { headers: { "Cache-Control": "no-store" } });
});
