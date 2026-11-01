import { MCP_PERMISSION_KEYS, type McpPermission, type McpToken, type McpTokenConfig, type McpTokenView } from "@menote/shared";

interface McpTokenRow {
  id: string; user_id: string; name: string; token_prefix: string; token_hash: string | null; token_ciphertext: string;
  permissions_json: string; scope_json: string; include_memos: number; allow_url: number;
  rate_per_minute: number; expires_at: number | null; revoked_at: number | null;
  created_at: number; last_used_at: number | null;
}

function parsePermissions(json: string): McpPermission[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is McpPermission =>
      typeof entry === "string" && MCP_PERMISSION_KEYS.some((known) => known === entry));
  } catch { return []; }
}

function parseScope(json: string): McpToken["scope"] {
  try {
    const value: unknown = JSON.parse(json);
    if (value && typeof value === "object" && "mode" in value &&
        (value.mode === "all" || value.mode === "selected") && "topicIds" in value && Array.isArray(value.topicIds) &&
        "groupIds" in value && Array.isArray(value.groupIds)) {
      return {
        mode: value.mode,
        topicIds: value.topicIds.filter((id): id is string => typeof id === "string"),
        groupIds: value.groupIds.filter((id): id is string => typeof id === "string"),
      };
    }
  } catch { /* malformed legacy scope falls back to no scoped disclosure */ }
  return { mode: "selected", topicIds: [], groupIds: [] };
}

function fromRow(row: McpTokenRow): McpToken {
  return {
    id: row.id, userId: row.user_id, name: row.name, tokenPrefix: row.token_prefix,
    tokenHash: row.token_hash ?? "", tokenEnc: { ciphertext: row.token_ciphertext },
    permissions: parsePermissions(row.permissions_json), scope: parseScope(row.scope_json),
    includeMemos: row.include_memos === 1, allowUrl: row.allow_url === 1,
    ratePerMinute: row.rate_per_minute, expiresAt: row.expires_at, revokedAt: row.revoked_at,
    createdAt: row.created_at, lastUsedAt: row.last_used_at,
  };
}

function toView(token: McpToken): McpTokenView {
  const { tokenHash: _tokenHash, tokenEnc: _tokenEnc, ...view } = token;
  return view;
}

const SELECT_TOKEN = `SELECT id, user_id, name, token_prefix, token_hash, token_ciphertext,
  permissions_json, scope_json, include_memos, allow_url, rate_per_minute, expires_at,
  revoked_at, created_at, last_used_at FROM mcp_tokens`;

export async function listMcpTokens(db: D1Database, userId: string): Promise<McpTokenView[]> {
  const rows = await db.prepare(`${SELECT_TOKEN} WHERE user_id = ? ORDER BY created_at DESC, id`)
    .bind(userId).all<McpTokenRow>();
  return rows.results.map((row) => toView(fromRow(row)));
}

export async function getMcpToken(db: D1Database, userId: string, id: string): Promise<McpToken | null> {
  const row = await db.prepare(`${SELECT_TOKEN} WHERE user_id = ? AND id = ?`)
    .bind(userId, id).first<McpTokenRow>();
  return row ? fromRow(row) : null;
}

export async function findMcpTokenByHash(db: D1Database, tokenHash: string): Promise<McpToken | null> {
  const row = await db.prepare(`${SELECT_TOKEN} WHERE token_hash = ?`)
    .bind(tokenHash).first<McpTokenRow>();
  return row ? fromRow(row) : null;
}

export async function listMcpScopeNodes(db: D1Database, userId: string) {
  const rows = await db.prepare(
    `SELECT id, parent_id, name, depth FROM topic_nodes
      WHERE user_id = ? AND deleted_at IS NULL AND is_enc_space = 0 ORDER BY depth, name, id`,
  ).bind(userId).all<{ id: string; parent_id: string | null; name: string; depth: number }>();
  return rows.results.map((row) => ({
    id: row.id, parentId: row.parent_id, name: row.name, depth: row.depth === 1 ? 1 as const : 0 as const,
  }));
}

export async function insertMcpToken(
  db: D1Database,
  userId: string,
  values: McpTokenConfig & { id: string; name: string | null; tokenPrefix: string; tokenHash: string; tokenCiphertext: string; createdAt: number },
): Promise<string> {
  await db.prepare(
    `INSERT INTO mcp_tokens (
      id, user_id, name, token_prefix, token_ciphertext, permissions_json, scope_json,
      include_memos, allow_url, rate_per_minute, expires_at, revoked_at,
      token_hash, created_at, last_used_at
    ) VALUES (?, ?, COALESCE(?, 'menote' || CAST(COALESCE((
      SELECT MAX(CASE WHEN name GLOB 'menote[0-9]*' AND substr(name, 7) NOT GLOB '*[^0-9]*'
        THEN CAST(substr(name, 7) AS INTEGER) END)
      FROM mcp_tokens WHERE user_id = ?
    ), 0) + 1 AS TEXT)), ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`,
  ).bind(
    values.id, userId, values.name, userId, values.tokenPrefix, values.tokenCiphertext,
    JSON.stringify(values.permissions), JSON.stringify(values.scope),
    values.includeMemos ? 1 : 0, values.allowUrl ? 1 : 0, values.ratePerMinute,
    values.expiresAt, values.tokenHash, values.createdAt,
  ).run();
  const row = await db.prepare("SELECT name FROM mcp_tokens WHERE user_id = ? AND id = ?")
    .bind(userId, values.id).first<{ name: string }>();
  if (!row) throw new Error("mcp_token_insert_failed");
  return row.name;
}

export async function updateMcpTokenConfig(
  db: D1Database, userId: string, id: string, name: string, config: McpTokenConfig,
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE mcp_tokens SET name = ?, permissions_json = ?, scope_json = ?, include_memos = ?, allow_url = ?,
      rate_per_minute = ?, expires_at = ? WHERE user_id = ? AND id = ? AND revoked_at IS NULL`,
  ).bind(name, JSON.stringify(config.permissions), JSON.stringify(config.scope), config.includeMemos ? 1 : 0,
    config.allowUrl ? 1 : 0, config.ratePerMinute, config.expiresAt, userId, id,
  ).run();
  return (result.meta.changes ?? 0) === 1;
}

export async function revokeMcpToken(db: D1Database, userId: string, id: string, now: number): Promise<boolean> {
  const result = await db.prepare(
    "UPDATE mcp_tokens SET revoked_at = ? WHERE user_id = ? AND id = ? AND revoked_at IS NULL",
  ).bind(now, userId, id).run();
  return (result.meta.changes ?? 0) === 1;
}

export async function touchMcpToken(db: D1Database, id: string, now: number): Promise<boolean> {
  const result = await db.prepare(
    "UPDATE mcp_tokens SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)",
  ).bind(now, id, now).run();
  return (result.meta.changes ?? 0) === 1;
}
