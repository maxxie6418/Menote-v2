CREATE TABLE backup_targets (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('webdav', 's3')),
  endpoint TEXT NOT NULL,
  bucket TEXT,
  username TEXT,
  secret_ciphertext BLOB NOT NULL,
  delete_policy TEXT NOT NULL,
  schedule TEXT NOT NULL,
  cursor_seq INTEGER,
  last_result TEXT,
  UNIQUE (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users (id)
)
