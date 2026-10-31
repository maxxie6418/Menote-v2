CREATE TABLE user_credentials (
  user_id TEXT PRIMARY KEY NOT NULL,
  algo TEXT NOT NULL,
  iterations INTEGER NOT NULL CHECK (iterations > 0),
  salt BLOB NOT NULL,
  hash BLOB NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
)
