CREATE TABLE job_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'failed')),
  detail TEXT
);
CREATE INDEX idx_job_runs_name_started ON job_runs (name, started_at);
