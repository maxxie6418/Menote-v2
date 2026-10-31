CREATE TABLE item_key_wraps (
  user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  wrapper TEXT NOT NULL CHECK (wrapper IN ('password', 'recovery', 'topic')),
  kdf_salt BLOB NOT NULL,
  kdf_iterations INTEGER NOT NULL CHECK (kdf_iterations > 0),
  iv BLOB NOT NULL,
  ciphertext BLOB NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id, wrapper)
);
CREATE TABLE topic_key_wraps (
  user_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  wrapper TEXT NOT NULL CHECK (wrapper IN ('password', 'recovery')),
  kdf_salt BLOB NOT NULL,
  kdf_iterations INTEGER NOT NULL,
  iv BLOB NOT NULL,
  ciphertext BLOB NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, topic_id, wrapper)
);
