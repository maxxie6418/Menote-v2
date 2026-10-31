import type { OutboxOperation, SyncOperationResult } from "@menote/shared";
import { Hono } from "hono";
import type { AppEnv } from "../middleware/session";
import { requireSession, resolveSession, sameOriginGuard } from "../middleware/session";
import {
  readAllItemsPage, readAllTopics, readItems, readLogPage, readSettings, readTopics, toTombstone,
} from "../db/sync";
import { applyOperation } from "../services/syncService";
import { ensureSchemaReady } from "../services/authService";

/** 同步路由（G6，按 G2 定稿）。推送逐操作独立事务；拉取游标 = sync_log.seq。 */

const PAGE_LIMIT = 200;
const PUSH_MAX_OPERATIONS = 10;
/** sync_log/操作表保留 90 天（G10 cleanup）；游标更旧的端触发全量。 */
const RETENTION_MS = 90 * 24 * 3_600_000;

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
  const ctx = { db: c.env.DB, userId: c.get("authUser")!.id, deviceId: deviceId.slice(0, 64), now: Date.now() };
  const results: SyncOperationResult[] = [];
  for (const operation of operations.slice(0, PUSH_MAX_OPERATIONS) as OutboxOperation[]) {
    if (typeof operation?.operationId !== "string" || typeof operation?.entityId !== "string") {
      return c.json({ error: "invalid_request" }, 400);
    }
    try {
      results.push(await applyOperation(ctx, operation));
    } catch (error) {
      const code = error instanceof Error && error.message.startsWith("invalid") ? "invalid_payload" : "entity_missing";
      results.push({ operationId: operation.operationId, result: "rejected", code });
    }
  }
  return c.json({ results }, { headers: { "Cache-Control": "no-store" } });
});

syncRoutes.get("/api/sync/pull", resolveSession, requireSession, async (c) => {
  if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
  const userId = c.get("authUser")!.id;
  const rawCursor = c.req.query("cursor") ?? "0";
  let cursor = Number.parseInt(rawCursor, 10);
  if (!Number.isSafeInteger(cursor) || cursor < 0) cursor = 0;
  const db = c.env.DB;
  const now = Date.now();

  const page = await readLogPage(db, userId, cursor, PAGE_LIMIT);
  // 游标早于保留窗口 → 全量重同步（G2 §4）；cursor=0 同样适用（有日志被清理即缺失状态）。
  const oldestSeq = page.oldestSeq;
  if (oldestSeq !== null && oldestSeq > cursor + 1) {
    const items = await readAllItemsPage(db, userId, 0, PAGE_LIMIT);
    const topics = await readAllTopics(db, userId);
    return c.json({
      items, topics, tombstones: [], settings: await readSettings(db, userId),
      nextCursor: String(oldestSeq - 1), hasMore: items.length === PAGE_LIMIT, fullResync: true,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  const itemIds = page.entries.filter((entry) => entry.entity === "item" && entry.op === "upsert").map((entry) => entry.entityId);
  const topicIds = page.entries.filter((entry) => entry.entity === "topic").map((entry) => entry.entityId);
  const items = await readItems(db, userId, itemIds);
  const topics = await readTopics(db, userId, topicIds);
  const tombstones = page.entries.filter((entry) => entry.op === "delete")
    .map((entry) => toTombstone(entry, userId, now));
  void RETENTION_MS;
  return c.json({
    items, topics, tombstones, settings: await readSettings(db, userId),
    nextCursor: page.entries.length > 0 ? String(page.entries[page.entries.length - 1]!.seq) : String(cursor),
    hasMore: page.hasMore, fullResync: false,
  }, { headers: { "Cache-Control": "no-store" } });
});
