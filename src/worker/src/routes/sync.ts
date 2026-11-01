import type { OutboxOperation, SyncOperationResult } from "@menote/shared";
import { Hono } from "hono";
import type { AppEnv } from "../middleware/session";
import { requireSession, resolveSession, sameOriginGuard } from "../middleware/session";
import { ensureSchemaReady } from "../services/authService";
import { applyOperations, buildSyncPage, type ApplyContext } from "../services/syncService";

/** 同步路由（G6，按 G2 定稿）。推送逐操作独立事务；拉取游标 = sync_log.seq。 */

const PUSH_MAX_OPERATIONS = 10;

export const syncRoutes = new Hono<AppEnv>();

syncRoutes.post("/api/sync/push", resolveSession, sameOriginGuard, requireSession, async (c) => {
  if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
  const body: unknown = await c.req.json().catch(() => null);
  const deviceId = (body as { deviceId?: unknown } | null)?.deviceId;
  const operations = (body as { operations?: unknown } | null)?.operations;
  if (typeof deviceId !== "string" || !deviceId.trim() || !Array.isArray(operations) || operations.length === 0) {
    return c.json({ error: "invalid_request" }, 400);
  }
  if (operations.length > PUSH_MAX_OPERATIONS) return c.json({ error: "too_many_operations" }, 400);
  const batch = operations.slice(0, PUSH_MAX_OPERATIONS) as OutboxOperation[];
  for (const operation of batch) {
    if (typeof operation?.operationId !== "string" || typeof operation?.entityId !== "string") {
      return c.json({ error: "invalid_request" }, 400);
    }
  }
  const ctx: ApplyContext = { db: c.env.DB, userId: c.get("authUser")!.id, deviceId: deviceId.slice(0, 64), now: Date.now() };
  const results: SyncOperationResult[] = await applyOperations(ctx, batch);
  return c.json({ results }, { headers: { "Cache-Control": "no-store" } });
});

syncRoutes.get("/api/sync/pull", resolveSession, requireSession, async (c) => {
  if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
  const userId = c.get("authUser")!.id;
  const rawCursor = c.req.query("cursor") ?? "0";
  let cursor = Number.parseInt(rawCursor, 10);
  if (!Number.isSafeInteger(cursor) || cursor < 0) cursor = 0;
  const page = await buildSyncPage(c.env.DB, userId, cursor, Date.now());
  return c.json(page, { headers: { "Cache-Control": "no-store" } });
});
