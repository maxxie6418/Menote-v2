import type { McpToken, McpTokenScope } from "@menote/shared";

type ItemAccess = Pick<McpToken, "userId" | "includeMemos" | "scope">;

export const MCP_ITEM_FROM = `FROM items i
  LEFT JOIN topic_nodes topic ON topic.user_id = i.user_id AND topic.id = i.topic_id
  LEFT JOIN topic_nodes grp ON grp.user_id = i.user_id AND grp.id = i.group_id
  LEFT JOIN topic_nodes parent ON parent.user_id = i.user_id AND parent.id = grp.parent_id`;

export const MCP_PLAIN_ITEM = "i.enc_self = 0 AND i.content_ciphertext IS NULL";

export function mcpItemAccess({ userId, includeMemos, scope }: ItemAccess, plainOnly: boolean) {
  const clauses = [
    "i.user_id = ?", "i.deleted_at IS NULL", "i.in_enc_space = 0",
    "COALESCE(topic.is_enc_space, 0) = 0", "COALESCE(grp.is_enc_space, 0) = 0", "COALESCE(parent.is_enc_space, 0) = 0",
    "topic.deleted_at IS NULL", "grp.deleted_at IS NULL", "parent.deleted_at IS NULL",
  ];
  const bindings: unknown[] = [userId];
  if (plainOnly) clauses.push(MCP_PLAIN_ITEM);
  if (!includeMemos) clauses.push("i.type != 'memo'");
  if (scope.mode === "selected") {
    clauses.push(`(i.topic_id IN (SELECT value FROM json_each(?)) OR i.group_id IN (SELECT value FROM json_each(?)))`);
    bindings.push(JSON.stringify(scope.topicIds), JSON.stringify(scope.groupIds));
  }
  return { clauses, bindings };
}

export async function findVisibleAttachmentOwner(
  db: D1Database, userId: string, sha256: string, includeMemos: boolean, scope: McpTokenScope,
): Promise<string | null> {
  const { clauses, bindings } = mcpItemAccess({ userId, includeMemos, scope }, true);
  const row = await db.prepare(
    `SELECT i.id ${MCP_ITEM_FROM} WHERE ${clauses.join(" AND ")}
       AND EXISTS (SELECT 1 FROM json_each(i.attachment_hashes_json) ref WHERE ref.value = ?)
     ORDER BY i.id LIMIT 1`,
  ).bind(...bindings, sha256).first<{ id: string }>();
  return row?.id ?? null;
}
