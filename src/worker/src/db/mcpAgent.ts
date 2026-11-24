import type { Item, McpItemQuery, McpItemSummary, McpToken } from "@menote/shared";
import { MCP_ITEM_FROM, MCP_PLAIN_ITEM, mcpItemAccess } from "./mcpPermissions";

interface SummaryRow {
  id: string;
  title: string | null;
  enc_self: number;
  type: Item["type"];
  tags_json: string;
  status: Item["status"];
  folder_id: string | null;
  rev: number;
  meta_rev: number;
  updated_at: number;
}

const summaryProjection = "i.id, i.title, i.enc_self, i.type, i.tags_json, i.status, COALESCE(i.group_id, i.topic_id) AS folder_id, i.rev, i.meta_rev, i.updated_at";

function toSummary(row: SummaryRow): McpItemSummary {
  if (row.enc_self) return { id: row.id, title: row.title, encrypted: true };
  return { id: row.id, title: row.title, encrypted: false, type: row.type, tags: JSON.parse(row.tags_json) as string[],
    status: row.status, folder_id: row.folder_id, rev: row.rev, meta_rev: row.meta_rev, updated_at: row.updated_at };
}

export async function findMcpItems(db: D1Database, token: McpToken, query: McpItemQuery, after: string, limit: number) {
  const { clauses, bindings } = mcpItemAccess(token, false);
  clauses.push("i.id > ?");
  bindings.push(after);
  if (query.type !== undefined) {
    clauses.push("i.type = ?");
    bindings.push(query.type);
  }
  if (query.folder_id !== undefined) {
    clauses.push(query.folder_id === null ? "i.topic_id IS NULL" : "(i.topic_id = ? OR i.group_id = ?)");
    if (query.folder_id !== null) bindings.push(query.folder_id, query.folder_id);
  }
  if (query.tag !== undefined) {
    clauses.push(MCP_PLAIN_ITEM, "EXISTS (SELECT 1 FROM json_each(i.tags_json) AS tag WHERE tag.value = ?)");
    bindings.push(query.tag);
  }
  if (query.task_status !== undefined) {
    clauses.push(MCP_PLAIN_ITEM, "i.status = ?");
    bindings.push(query.task_status);
  }
  if (query.updated_after !== undefined) {
    clauses.push(MCP_PLAIN_ITEM, "i.updated_at > ?");
    bindings.push(query.updated_after);
  }
  if (query.query !== undefined) {
    clauses.push(`(INSTR(LOWER(COALESCE(i.title, '')), LOWER(?)) > 0
      OR (${MCP_PLAIN_ITEM} AND INSTR(LOWER(i.content_markdown), LOWER(?)) > 0))`);
    bindings.push(query.query, query.query);
  }
  const { results } = await db.prepare(
    `SELECT ${summaryProjection} ${MCP_ITEM_FROM} WHERE ${clauses.join(" AND ")} ORDER BY i.id LIMIT ?`,
  ).bind(...bindings, limit).all<SummaryRow>();
  return results.map(toSummary);
}

export async function listMcpFolders(db: D1Database, token: McpToken, after: string, limit: number) {
  const { clauses, bindings } = mcpItemAccess(token, true);
  const selected = token.scope.mode === "selected";
  const topics = JSON.stringify(token.scope.topicIds);
  const groups = JSON.stringify(token.scope.groupIds);
  const { results } = await db.prepare(
    `WITH visible AS (
      SELECT n.id, n.parent_id, n.name, n.depth
      FROM topic_nodes n
      LEFT JOIN topic_nodes p ON p.user_id = n.user_id AND p.id = n.parent_id
      WHERE n.user_id = ? AND n.deleted_at IS NULL AND n.is_enc_space = 0
        AND p.deleted_at IS NULL AND COALESCE(p.is_enc_space, 0) = 0 AND n.id > ?
        AND (? = 0 OR n.id IN (SELECT value FROM json_each(?))
          OR n.parent_id IN (SELECT value FROM json_each(?))
          OR n.id IN (SELECT value FROM json_each(?))
          OR n.id IN (SELECT parent_id FROM topic_nodes
            WHERE user_id = ? AND deleted_at IS NULL AND is_enc_space = 0 AND id IN (SELECT value FROM json_each(?))))
      ORDER BY n.id LIMIT ?
    )
    SELECT n.*, (SELECT COUNT(*) ${MCP_ITEM_FROM} WHERE ${clauses.join(" AND ")}
      AND (i.topic_id = n.id OR i.group_id = n.id)) AS item_count
    FROM visible n ORDER BY n.id`,
  ).bind(token.userId, after, Number(selected), topics, topics, groups, token.userId, groups, limit, ...bindings)
    .all<{ id: string; parent_id: string | null; name: string; depth: number; item_count: number }>();
  return results;
}

export async function readMcpItem(db: D1Database, token: McpToken, id: string, start: number, count: number, attachmentAccess: boolean) {
  const { clauses, bindings } = mcpItemAccess(token, false);
  const row = await db.prepare(
    `SELECT ${summaryProjection}, SUBSTR(i.content_markdown, ?, ?) AS content,
        CASE WHEN ? = 1 AND ${MCP_PLAIN_ITEM} THEN i.attachment_hashes_json END AS attachments
      ${MCP_ITEM_FROM} WHERE ${clauses.join(" AND ")} AND i.id = ?`,
  ).bind(start + 1, count, Number(attachmentAccess), ...bindings, id)
    .first<SummaryRow & { content: string | null; attachments: string | null }>();
  if (!row) return null;
  const summary = toSummary(row);
  return summary.encrypted ? summary : { ...summary, content: row.content ?? "",
    ...(row.attachments !== null ? { attachment_hashes: JSON.parse(row.attachments) as string[] } : {}) };
}

export async function listMcpVersions(db: D1Database, token: McpToken, itemId: string, after: string, limit: number) {
  const { clauses, bindings } = mcpItemAccess(token, true);
  const { results } = await db.prepare(
    `SELECT v.id, v.reason, v.created_at
      ${MCP_ITEM_FROM} JOIN item_versions v ON v.user_id = i.user_id AND v.item_id = i.id
      WHERE ${clauses.join(" AND ")} AND i.id = ? AND v.encrypted = 0 AND v.id > ?
      ORDER BY v.id LIMIT ?`,
  ).bind(...bindings, itemId, after, limit).all<{ id: string; reason: string; created_at: number }>();
  return results;
}

export async function readMcpVersion(db: D1Database, token: McpToken, itemId: string, versionId: string) {
  const { clauses, bindings } = mcpItemAccess(token, true);
  return db.prepare(
    `SELECT v.id, v.codec, v.snapshot_plain
      ${MCP_ITEM_FROM} JOIN item_versions v ON v.user_id = i.user_id AND v.item_id = i.id
      WHERE ${clauses.join(" AND ")} AND i.id = ? AND v.id = ? AND v.encrypted = 0`,
  ).bind(...bindings, itemId, versionId).first<{ id: string; codec: "identity" | "gzip"; snapshot_plain: unknown }>();
}
