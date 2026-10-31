CREATE TABLE item_versions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  encrypted INTEGER NOT NULL CHECK (encrypted IN (0, 1)),
  snapshot_plain BLOB,
  snapshot_ciphertext BLOB,
  codec TEXT NOT NULL CHECK (codec IN ('identity', 'gzip')),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, id),
  FOREIGN KEY (user_id, item_id) REFERENCES items (user_id, id),
  CHECK ((encrypted = 0 AND snapshot_plain IS NOT NULL AND snapshot_ciphertext IS NULL)
      OR (encrypted = 1 AND snapshot_plain IS NULL AND snapshot_ciphertext IS NOT NULL))
)
