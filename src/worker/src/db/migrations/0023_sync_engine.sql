CREATE TABLE sync_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  entity TEXT NOT NULL CHECK (entity IN ('item', 'topic')),
  entity_id TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
  rev INTEGER NOT NULL DEFAULT 0,
  meta_rev INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sync_log_user_seq ON sync_log (user_id, seq);

CREATE TABLE sync_operations (
  user_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  result TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0,
  meta_rev INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, operation_id)
);

ALTER TABLE items ADD COLUMN last_device TEXT;
ALTER TABLE attachments ADD COLUMN orphaned_at INTEGER;
ALTER TABLE user_settings ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_settings ADD COLUMN updated_at INTEGER;
