CREATE TABLE clip_templates (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  template_json TEXT NOT NULL CHECK (json_valid(template_json)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users (id)
);
CREATE INDEX clip_templates_user_updated ON clip_templates (user_id, updated_at DESC);
