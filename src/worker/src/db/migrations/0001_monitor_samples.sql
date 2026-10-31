CREATE TABLE monitor_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  service TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  sampled_at INTEGER NOT NULL
)
