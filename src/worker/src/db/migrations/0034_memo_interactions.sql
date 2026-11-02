ALTER TABLE items ADD COLUMN memo_quote_source_id TEXT;
ALTER TABLE items ADD COLUMN memo_quote_source_created_at INTEGER;
ALTER TABLE items ADD COLUMN memo_quote_snapshot TEXT;

CREATE TABLE memo_comments (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  memo_id TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1 CHECK (rev > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users (id),
  FOREIGN KEY (user_id, memo_id) REFERENCES items (user_id, id) ON DELETE CASCADE
);
CREATE INDEX memo_comments_owner_order ON memo_comments (user_id, memo_id, created_at, id);

CREATE TRIGGER memo_comments_validate_insert BEFORE INSERT ON memo_comments
WHEN NOT EXISTS (SELECT 1 FROM items WHERE user_id = NEW.user_id AND id = NEW.memo_id AND type = 'memo')
BEGIN SELECT RAISE(ABORT, 'memo_comment_owner_invalid'); END;
CREATE TRIGGER memo_comments_validate_update BEFORE UPDATE OF user_id, memo_id ON memo_comments
WHEN NOT EXISTS (SELECT 1 FROM items WHERE user_id = NEW.user_id AND id = NEW.memo_id AND type = 'memo')
BEGIN SELECT RAISE(ABORT, 'memo_comment_owner_invalid'); END;

ALTER TABLE sync_log RENAME TO sync_log_legacy;
CREATE TABLE sync_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  entity TEXT NOT NULL CHECK (entity IN ('item', 'topic', 'memo_comment')),
  entity_id TEXT NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
  rev INTEGER NOT NULL DEFAULT 0,
  meta_rev INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
INSERT INTO sync_log (seq, user_id, entity, entity_id, op, rev, meta_rev, created_at)
SELECT seq, user_id, entity, entity_id, op, rev, meta_rev, created_at FROM sync_log_legacy;
DROP TABLE sync_log_legacy;
CREATE INDEX idx_sync_log_user_seq ON sync_log (user_id, seq);
