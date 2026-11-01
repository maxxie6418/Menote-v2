CREATE TABLE mcp_rate_limits (
  token_id TEXT PRIMARY KEY NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  FOREIGN KEY (token_id) REFERENCES mcp_tokens (id) ON DELETE CASCADE
);
