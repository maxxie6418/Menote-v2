CREATE TABLE monitor_hourly (
  user_id TEXT NOT NULL,
  service TEXT NOT NULL,
  metric TEXT NOT NULL,
  bucket_at INTEGER NOT NULL,
  estimate REAL NOT NULL,
  sample_count INTEGER NOT NULL CHECK (sample_count > 0),
  last_sample INTEGER NOT NULL,
  PRIMARY KEY (user_id, service, metric, bucket_at)
)
