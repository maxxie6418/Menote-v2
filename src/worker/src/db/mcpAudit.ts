export interface McpAuditWrite {
  id: string;
  userId: string;
  tokenId: string;
  tool: string;
  itemId: string | null;
  resourceId?: string | null;
  revBefore: number | null;
  revAfter: number | null;
  result: string;
  operationId: string | null;
  at: number;
}

/** Append an MCP audit event; payload text and attachment bytes are intentionally excluded. */
export async function appendMcpAudit(db: D1Database, entry: McpAuditWrite): Promise<void> {
  await db.prepare(
    `INSERT INTO mcp_audit (id, user_id, token_id, tool, item_id, rev_before, rev_after, result, operation_id, at, resource_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(entry.id, entry.userId, entry.tokenId, entry.tool, entry.itemId, entry.revBefore,
    entry.revAfter, entry.result, entry.operationId, entry.at, entry.resourceId ?? null).run();
}

/** Fixed-window counter updated in one SQLite statement to remain consistent across isolates. */
export async function incrementMcpRateLimit(db: D1Database, tokenId: string, now: number): Promise<number> {
  const windowStart = Math.floor(now / 60_000) * 60_000;
  const row = await db.prepare(
    `INSERT INTO mcp_rate_limits (token_id, window_start, request_count) VALUES (?, ?, 1)
     ON CONFLICT (token_id) DO UPDATE SET
       window_start = excluded.window_start,
       request_count = CASE WHEN mcp_rate_limits.window_start = excluded.window_start
         THEN mcp_rate_limits.request_count + 1 ELSE 1 END
     RETURNING request_count`,
  ).bind(tokenId, windowStart).first<{ request_count: number }>();
  return row?.request_count ?? Number.MAX_SAFE_INTEGER;
}

/** Only hashes uploaded through this token may be attached by its clip tool. */
export async function verifyMcpClipAttachments(
  db: D1Database, tokenId: string, userId: string, hashes: string[], sealedMime: string,
): Promise<boolean> {
  if (!hashes.length) return true;
  const row = await db.prepare(
    `SELECT 1 AS missing FROM json_each(?) AS requested
     WHERE NOT EXISTS (SELECT 1 FROM attachments AS a
       WHERE a.user_id = ? AND a.sha256 = requested.value AND a.retired_at IS NULL
         AND a.size > 0 AND a.mime != ?)
        OR NOT EXISTS (SELECT 1 FROM mcp_audit AS audit WHERE audit.token_id = ? AND audit.user_id = ?
          AND audit.tool = 'upload_attachment' AND audit.resource_id = requested.value AND audit.result = 'uploaded')
     LIMIT 1`,
  ).bind(JSON.stringify(hashes), userId, sealedMime, tokenId, userId).first<{ missing: number }>();
  return row === null;
}
