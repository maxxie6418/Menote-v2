CREATE TABLE attachments (
  user_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  mime TEXT NOT NULL,
  ref_count INTEGER NOT NULL DEFAULT 0 CHECK (ref_count >= 0),
  PRIMARY KEY (user_id, sha256),
  FOREIGN KEY (user_id) REFERENCES users (id)
)
