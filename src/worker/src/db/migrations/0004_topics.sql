CREATE TABLE topic_nodes (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  depth INTEGER NOT NULL CHECK (depth IN (0, 1)),
  is_enc_space INTEGER NOT NULL DEFAULT 0 CHECK (is_enc_space IN (0, 1)),
  deleted_at INTEGER,
  UNIQUE (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users (id),
  FOREIGN KEY (user_id, parent_id) REFERENCES topic_nodes (user_id, id),
  CHECK ((depth = 0 AND parent_id IS NULL) OR (depth = 1 AND parent_id IS NOT NULL))
)
