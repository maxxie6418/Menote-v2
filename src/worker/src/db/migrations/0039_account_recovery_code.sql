-- Only ciphertext and an opaque identifier cross devices. The revision protects legacy adoption.
CREATE TABLE account_recovery_codes (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  binding_id TEXT,
  verifier_json TEXT,
  wrap_revision INTEGER NOT NULL DEFAULT 0,
  CHECK ((binding_id IS NULL AND verifier_json IS NULL) OR
         (binding_id IS NOT NULL AND verifier_json IS NOT NULL AND json_valid(verifier_json)))
);

ALTER TABLE item_key_wraps ADD COLUMN recovery_code_id TEXT;

CREATE TRIGGER item_key_wraps_recovery_guard BEFORE INSERT ON item_key_wraps
WHEN NEW.wrapper = 'recovery'
  AND (NEW.recovery_code_id IS NOT NULL OR EXISTS (SELECT 1 FROM account_recovery_codes a WHERE a.user_id = NEW.user_id AND a.binding_id IS NOT NULL))
  AND NEW.recovery_code_id IS NOT (SELECT a.binding_id FROM account_recovery_codes a WHERE a.user_id = NEW.user_id)
  AND NOT EXISTS (
    SELECT 1 FROM item_key_wraps w
    WHERE w.user_id = NEW.user_id AND w.wrapper = 'recovery'
      AND (w.item_id = NEW.item_id OR w.item_id = (
        SELECT conflict_of FROM items WHERE user_id = NEW.user_id AND id = NEW.item_id
      ))
      AND w.kdf_salt = NEW.kdf_salt AND w.kdf_iterations = NEW.kdf_iterations
      AND w.iv = NEW.iv AND w.ciphertext = NEW.ciphertext AND w.generation = NEW.generation
      AND NEW.recovery_code_id IS NULL
  )
BEGIN SELECT RAISE(ABORT, 'recovery_code_binding_required'); END;

CREATE TRIGGER item_key_wraps_recovery_added AFTER INSERT ON item_key_wraps
WHEN NEW.wrapper = 'recovery'
BEGIN
  INSERT INTO account_recovery_codes (user_id, wrap_revision) VALUES (NEW.user_id, 1)
  ON CONFLICT (user_id) DO UPDATE SET wrap_revision = wrap_revision + 1;
END;

CREATE TRIGGER item_key_wraps_recovery_changed AFTER UPDATE ON item_key_wraps
WHEN NEW.wrapper = 'recovery' AND (NEW.ciphertext != OLD.ciphertext OR NEW.iv != OLD.iv
  OR NEW.kdf_iterations != OLD.kdf_iterations OR NEW.kdf_salt != OLD.kdf_salt OR NEW.generation != OLD.generation)
BEGIN
  INSERT INTO account_recovery_codes (user_id, wrap_revision) VALUES (NEW.user_id, 1)
  ON CONFLICT (user_id) DO UPDATE SET wrap_revision = wrap_revision + 1;
END;

ALTER TABLE topic_key_wraps ADD COLUMN recovery_code_id TEXT;

CREATE TRIGGER topic_key_wraps_recovery_guard BEFORE INSERT ON topic_key_wraps
WHEN NEW.wrapper = 'recovery'
  AND (NEW.recovery_code_id IS NOT NULL OR EXISTS (SELECT 1 FROM account_recovery_codes a WHERE a.user_id = NEW.user_id AND a.binding_id IS NOT NULL))
  AND NEW.recovery_code_id IS NOT (SELECT a.binding_id FROM account_recovery_codes a WHERE a.user_id = NEW.user_id)
  AND NOT EXISTS (
    SELECT 1 FROM topic_key_wraps w
    WHERE w.user_id = NEW.user_id AND w.topic_id = NEW.topic_id AND w.wrapper = 'recovery'
      AND w.kdf_salt = NEW.kdf_salt AND w.kdf_iterations = NEW.kdf_iterations
      AND w.iv = NEW.iv AND w.ciphertext = NEW.ciphertext AND w.generation = NEW.generation
      AND NEW.recovery_code_id IS NULL
  )
BEGIN SELECT RAISE(ABORT, 'recovery_code_binding_required'); END;

CREATE TRIGGER topic_key_wraps_recovery_added AFTER INSERT ON topic_key_wraps
WHEN NEW.wrapper = 'recovery'
BEGIN
  INSERT INTO account_recovery_codes (user_id, wrap_revision) VALUES (NEW.user_id, 1)
  ON CONFLICT (user_id) DO UPDATE SET wrap_revision = wrap_revision + 1;
END;

CREATE TRIGGER topic_key_wraps_recovery_changed AFTER UPDATE ON topic_key_wraps
WHEN NEW.wrapper = 'recovery' AND (NEW.ciphertext != OLD.ciphertext OR NEW.iv != OLD.iv
  OR NEW.kdf_iterations != OLD.kdf_iterations OR NEW.kdf_salt != OLD.kdf_salt OR NEW.generation != OLD.generation)
BEGIN
  INSERT INTO account_recovery_codes (user_id, wrap_revision) VALUES (NEW.user_id, 1)
  ON CONFLICT (user_id) DO UPDATE SET wrap_revision = wrap_revision + 1;
END;
