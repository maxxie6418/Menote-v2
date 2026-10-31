import type { Item, TopicNode } from "@menote/shared";
import { Hono } from "hono";
import type { AppEnv } from "../middleware/session";
import { requireSession, resolveSession, sameOriginGuard } from "../middleware/session";
import { rowToItem, readSettings } from "../db/sync";
import { appendSyncLog, upsertItemRow, upsertTopicRow } from "../db/sync";
import { putItemWraps } from "../db/keyWraps";
import { ensureSchemaReady } from "../services/authService";

/** 恢复导入（FR-BAK-9 工具侧）：接受备份分片条目与包装块，按 id 合并（rev 高者胜）。
 *  会话用户为归属；恢复到干净环境 = 新部署注册账号后导入。 */
export const restoreRoutes = new Hono<AppEnv>();

restoreRoutes.post("/api/restore", resolveSession, sameOriginGuard, requireSession, async (c) => {
  if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
  const body: unknown = await c.req.json().catch(() => null);
  const entries = (body as { entries?: unknown } | null)?.entries;
  const itemKeyWraps = (body as { itemKeyWraps?: unknown } | null)?.itemKeyWraps;
  if (!Array.isArray(entries) || entries.length === 0) return c.json({ error: "invalid_request" }, 400);
  const userId = c.get("authUser")!.id;
  const now = Date.now();
  let items = 0;
  let topics = 0;
  for (const entry of entries.slice(0, 5000)) {
    const record = (entry as { kind?: unknown; data?: unknown });
    if (record?.kind === "item" && typeof record.data === "object" && record.data !== null) {
      const item = rowToItem(record.data as Record<string, unknown>) as Item;
      await upsertItemRow(c.env.DB, userId, "restore", item, item.rev, item.metaRev);
      await appendSyncLog(c.env.DB, userId, "item", item.id, "upsert", item.rev, item.metaRev, now);
      items += 1;
    } else if (record?.kind === "topic" && typeof record.data === "object" && record.data !== null) {
      const row = record.data as Record<string, unknown>;
      const topic: TopicNode = {
        id: String(row.id), userId, parentId: row.parent_id === null || row.parent_id === undefined ? null : String(row.parent_id),
        name: String(row.name), depth: Number(row.depth) === 1 ? 1 : 0, isEncSpace: Number(row.is_enc_space) === 1,
        deletedAt: row.deleted_at === null || row.deleted_at === undefined ? null : Number(row.deleted_at),
      };
      await upsertTopicRow(c.env.DB, userId, topic, topic.deletedAt);
      await appendSyncLog(c.env.DB, userId, "topic", topic.id, "upsert", 0, 0, now);
      topics += 1;
    }
  }
  if (Array.isArray(itemKeyWraps)) {
    for (const raw of itemKeyWraps as Array<Record<string, unknown>>) {
      const itemId = String(raw.item_id ?? "");
      const b64 = (value: unknown): string => {
        const bytes = value instanceof Uint8Array ? value : Uint8Array.from(String(value ?? ""), (char) => char.charCodeAt(0));
        return btoa(String.fromCharCode(...bytes));
      };
      await putItemWraps(c.env.DB, userId, itemId, [{
        wrapper: String(raw.wrapper) as "password",
        kdfSalt: b64(raw.kdf_salt), kdfIterations: Number(raw.kdf_iterations), iv: b64(raw.iv),
        ciphertext: b64(raw.ciphertext), generation: Number(raw.generation ?? 0),
      }], now);
    }
  }
  void readSettings;
  return c.json({ ok: true, items, topics }, { headers: { "Cache-Control": "no-store" } });
});
