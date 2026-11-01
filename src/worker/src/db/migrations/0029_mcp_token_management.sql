ALTER TABLE mcp_tokens ADD COLUMN token_hash TEXT;
ALTER TABLE mcp_tokens ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mcp_tokens ADD COLUMN last_used_at INTEGER;

CREATE UNIQUE INDEX idx_mcp_tokens_hash ON mcp_tokens (token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX idx_mcp_tokens_user_created ON mcp_tokens (user_id, created_at DESC);
