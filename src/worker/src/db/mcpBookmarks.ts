import type { Item, McpTokenScope } from "@menote/shared";
import { rowToItem } from "./sync";

/** Load only one owner-scoped bookmark target and its plain-text visibility boundary. */
export async function readMcpBookmarkTarget(
  db: D1Database, userId: string, itemId: string, scope: McpTokenScope,
): Promise<Item | null> {
  const bind: unknown[] = [userId, itemId];
  const clauses = [
    "i.user_id = ?", "i.id = ?", "i.deleted_at IS NULL", "i.enc_self = 0", "i.in_enc_space = 0",
    "i.content_ciphertext IS NULL", "(topic.is_enc_space IS NULL OR topic.is_enc_space = 0)",
    "(grp.is_enc_space IS NULL OR grp.is_enc_space = 0)", "i.type IN ('note', 'table')",
  ];
  if (scope.mode === "selected") {
    const choices: string[] = [];
    if (scope.topicIds.length) {
      choices.push(`i.topic_id IN (${scope.topicIds.map(() => "?").join(",")})`);
      bind.push(...scope.topicIds);
    }
    if (scope.groupIds.length) {
      choices.push(`i.group_id IN (${scope.groupIds.map(() => "?").join(",")})`);
      bind.push(...scope.groupIds);
    }
    clauses.push(choices.length ? `(${choices.join(" OR ")})` : "0 = 1");
  }
  const row = await db.prepare(
    `SELECT i.* FROM items i
       LEFT JOIN topic_nodes topic ON topic.user_id = i.user_id AND topic.id = i.topic_id
       LEFT JOIN topic_nodes grp ON grp.user_id = i.user_id AND grp.id = i.group_id
     WHERE ${clauses.join(" AND ")} LIMIT 1`,
  ).bind(...bind).first<Record<string, unknown>>();
  return row ? rowToItem(row) : null;
}
