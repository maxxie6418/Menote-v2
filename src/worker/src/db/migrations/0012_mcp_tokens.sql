CREATE TABLE mcp_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  token_ciphertext BLOB NOT NULL,
  permissions_json TEXT NOT NULL CHECK (json_valid(permissions_json) AND json_type(permissions_json) = 'array'),
  scope_json TEXT NOT NULL CHECK (json_valid(scope_json)),
  include_memos INTEGER NOT NULL CHECK (include_memos IN (0, 1)),
  allow_url INTEGER NOT NULL CHECK (allow_url IN (0, 1)),
  rate_per_minute INTEGER NOT NULL CHECK (rate_per_minute > 0),
  expires_at INTEGER,
  revoked_at INTEGER,
  UNIQUE (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users (id)
)
