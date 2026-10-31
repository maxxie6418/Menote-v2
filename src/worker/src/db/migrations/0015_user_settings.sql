CREATE TABLE user_settings (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  is_secret INTEGER NOT NULL CHECK (is_secret IN (0, 1)),
  value_json TEXT,
  value_ciphertext BLOB,
  PRIMARY KEY (user_id, key),
  FOREIGN KEY (user_id) REFERENCES users (id),
  CHECK ((is_secret = 0 AND value_json IS NOT NULL AND json_valid(value_json) AND value_ciphertext IS NULL)
      OR (is_secret = 1 AND value_json IS NULL AND value_ciphertext IS NOT NULL))
)
