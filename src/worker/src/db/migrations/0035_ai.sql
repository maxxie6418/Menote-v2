-- TP8：AI 助手任务与每日用量（FR-AI-2）。任务表按 (user, item, kind, content_hash) 支持结果复用与去重；用量表按 UTC 日累计。
CREATE TABLE ai_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('summary', 'tags')),
  content_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id)
);
CREATE INDEX idx_ai_tasks_reuse ON ai_tasks (user_id, item_id, kind, content_hash, status);
CREATE INDEX idx_ai_tasks_updated ON ai_tasks (updated_at);

CREATE TABLE ai_usage_daily (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  PRIMARY KEY (user_id, day),
  FOREIGN KEY (user_id) REFERENCES users (id)
);
