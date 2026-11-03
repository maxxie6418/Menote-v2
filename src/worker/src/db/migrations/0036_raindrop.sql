-- TP9：Raindrop 连接器（FR-EXT-3）。账号令牌（密文）与绑定配置、行级同步账本、同步运行记录；
-- 连接器元数据存 D1 不进 Markdown（主文档 7.3 v0.24）；独立表不与业务表耦合。
CREATE TABLE raindrop_accounts (
  user_id TEXT PRIMARY KEY NOT NULL,
  token_ciphertext TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE raindrop_bindings (
  user_id TEXT PRIMARY KEY NOT NULL,
  table_item_id TEXT NOT NULL,
  collection_id INTEGER NOT NULL DEFAULT 0,
  pull_interval_hours INTEGER NOT NULL DEFAULT 1 CHECK (pull_interval_hours IN (1, 6, 24)),
  last_pull_at INTEGER,
  last_push_at INTEGER,
  last_snapshot_key TEXT,
  last_snapshot_hash TEXT,
  last_snapshot_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE raindrop_sync_rows (
  user_id TEXT NOT NULL,
  menote_row_id TEXT NOT NULL,
  raindrop_id TEXT NOT NULL,
  baseline_json TEXT NOT NULL CHECK (json_valid(baseline_json)),
  baseline_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('synced', 'dirty', 'conflict', 'orphaned', 'remote_missing')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, menote_row_id),
  FOREIGN KEY (user_id) REFERENCES users (id)
);
CREATE INDEX idx_raindrop_sync_rows_remote ON raindrop_sync_rows (user_id, raindrop_id);

CREATE TABLE raindrop_sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('pull', 'push')),
  source TEXT NOT NULL CHECK (source IN ('scheduled', 'manual')),
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'partial', 'failed')),
  pulled_new INTEGER NOT NULL DEFAULT 0,
  pulled_updated INTEGER NOT NULL DEFAULT 0,
  conflicts INTEGER NOT NULL DEFAULT 0,
  remote_missing INTEGER NOT NULL DEFAULT 0,
  orphans INTEGER NOT NULL DEFAULT 0,
  push_created INTEGER NOT NULL DEFAULT 0,
  push_updated INTEGER NOT NULL DEFAULT 0,
  push_failed INTEGER NOT NULL DEFAULT 0,
  detail TEXT,
  FOREIGN KEY (user_id) REFERENCES users (id)
);
CREATE INDEX idx_raindrop_sync_runs_user ON raindrop_sync_runs (user_id, id);
