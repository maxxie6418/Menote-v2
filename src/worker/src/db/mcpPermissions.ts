import type { McpTokenScope } from "@menote/shared";

/** Resolve one visible plain-text owner for an attachment without returning its content. */
export async function findVisibleAttachmentOwner(
  db: D1Database, userId: string, sha256: string, includeMemos: boolean, scope: McpTokenScope,
): Promise<string | null> {
  const bind: unknown[] = [userId, sha256];
  const clauses = [
    "i.user_id = ?", "i.deleted_at IS NULL", "i.enc_self = 0", "i.in_enc_space = 0",
    "i.content_ciphertext IS NULL", "(topic.is_enc_space IS NULL OR topic.is_enc_space = 0)",
    "(grp.is_enc_space IS NULL OR grp.is_enc_space = 0)",
    "EXISTS (SELECT 1 FROM json_each(i.attachment_hashes_json) ref WHERE ref.value = ?)",
  ];
  if (!includeMemos) clauses.push("i.type != 'memo'");
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
    `SELECT i.id FROM items i
       LEFT JOIN topic_nodes topic ON topic.user_id = i.user_id AND topic.id = i.topic_id
       LEFT JOIN topic_nodes grp ON grp.user_id = i.user_id AND grp.id = i.group_id
     WHERE ${clauses.join(" AND ")} ORDER BY i.id LIMIT 1`,
  ).bind(...bind).first<{ id: string }>();
  return row?.id ?? null;
}
