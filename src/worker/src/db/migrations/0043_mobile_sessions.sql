CREATE TABLE mobile_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_mobile_sessions_expiry ON mobile_sessions (expires_at);
