import type { Item, McpTokenScope } from "@menote/shared";
import { MCP_ITEM_FROM, mcpItemAccess } from "./mcpPermissions";
import { appendSyncLogStatement, recordSyncOperationStatement, rowToItem } from "./sync";

/** Load only one owner-scoped bookmark target and its plain-text visibility boundary. */
export async function readMcpBookmarkTarget(
  db: SqlDatabase, userId: string, itemId: string, scope: McpTokenScope,
): Promise<Item | null> {
  const { clauses, bindings } = mcpItemAccess({ userId, scope, includeMemos: false }, true);
  const row = await db.prepare(
    `SELECT i.* ${MCP_ITEM_FROM} WHERE ${clauses.join(" AND ")} AND i.id = ?`,
  ).bind(...bindings, itemId).first<Record<string, unknown>>();
  return row ? rowToItem(row) : null;
}

export async function writeMcpBookmark(
  db: SqlDatabase, item: Item, scope: McpTokenScope, tokenId: string, operationId: string,
  markdown: string, contentHash: string, now: number,
): Promise<boolean> {
  const { clauses, bindings } = mcpItemAccess({ userId: item.userId, scope, includeMemos: false }, true);
  const rev = item.rev + 1;
  const [write] = await db.batch([
    db.prepare(`UPDATE items SET content_markdown = ?, content_hash = ?, rev = ?, updated_at = ?, last_device = ?
      WHERE user_id = ? AND id = ? AND rev = ? AND meta_rev = ?
        AND id IN (SELECT i.id ${MCP_ITEM_FROM} WHERE ${clauses.join(" AND ")} AND i.id = ?)
        AND NOT EXISTS (SELECT 1 FROM sync_operations WHERE user_id = ? AND operation_id = ?)`)
      .bind(markdown, contentHash, rev, now, `mcp:${tokenId}`, item.userId, item.id, item.rev, item.metaRev,
        ...bindings, item.id, item.userId, operationId),
    appendSyncLogStatement(db, item.userId, "item", item.id, "upsert", rev, item.metaRev, now, true),
    recordSyncOperationStatement(db, item.userId, operationId, "item", item.id, "applied", rev, item.metaRev, contentHash, now, "after_change"),
  ]);
  return write?.meta.changes === 1;
}
