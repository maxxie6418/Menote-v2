CREATE TABLE monitor_cloudflare_credentials (
  user_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  token_ciphertext TEXT NOT NULL,
  script_name TEXT NOT NULL,
  d1_database_id TEXT,
  r2_bucket_name TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
