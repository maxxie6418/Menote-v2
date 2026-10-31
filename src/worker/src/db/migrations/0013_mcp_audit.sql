CREATE TABLE mcp_audit (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  token_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  item_id TEXT,
  rev_before INTEGER,
  rev_after INTEGER,
  result TEXT NOT NULL,
  operation_id TEXT,
  at INTEGER NOT NULL,
  FOREIGN KEY (user_id, token_id) REFERENCES mcp_tokens (user_id, id)
)
