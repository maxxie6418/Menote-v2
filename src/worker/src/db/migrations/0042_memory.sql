CREATE TABLE memory_bindings (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users (id),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  binding_id TEXT UNIQUE,
  table_item_id TEXT,
  CHECK ((binding_id IS NULL) = (table_item_id IS NULL))
);

CREATE TABLE memory_operations (
  user_id TEXT NOT NULL REFERENCES users (id),
  binding_id TEXT NOT NULL,
  token_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  row_id TEXT NOT NULL,
  rev_before INTEGER,
  rev_after INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, binding_id, token_id, operation_id)
);

CREATE TRIGGER raindrop_blocks_memory_table_insert BEFORE INSERT ON raindrop_bindings
WHEN EXISTS (SELECT 1 FROM memory_bindings WHERE user_id = NEW.user_id AND table_item_id = NEW.table_item_id)
BEGIN SELECT RAISE(ABORT, 'memory_table_already_bound'); END;

CREATE TRIGGER raindrop_blocks_memory_table_update BEFORE UPDATE OF table_item_id ON raindrop_bindings
WHEN EXISTS (SELECT 1 FROM memory_bindings WHERE user_id = NEW.user_id AND table_item_id = NEW.table_item_id)
BEGIN SELECT RAISE(ABORT, 'memory_table_already_bound'); END;
