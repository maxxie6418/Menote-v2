-- Isolate conditional writes to the batch that acquired the account revision.
ALTER TABLE account_recovery_codes ADD COLUMN rotation_nonce TEXT;

CREATE TRIGGER item_key_wraps_recovery_removed AFTER DELETE ON item_key_wraps
WHEN OLD.wrapper = 'recovery'
BEGIN
  INSERT INTO account_recovery_codes (user_id, wrap_revision)
  SELECT OLD.user_id, 1 WHERE EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id)
  ON CONFLICT (user_id) DO UPDATE SET wrap_revision = wrap_revision + 1;
END;

CREATE TRIGGER topic_key_wraps_recovery_removed AFTER DELETE ON topic_key_wraps
WHEN OLD.wrapper = 'recovery'
BEGIN
  INSERT INTO account_recovery_codes (user_id, wrap_revision)
  SELECT OLD.user_id, 1 WHERE EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id)
  ON CONFLICT (user_id) DO UPDATE SET wrap_revision = wrap_revision + 1;
END;

-- Account bindings carry forward legacy identical replays until the first rotation.
-- Once rotated, unlabelled identical copies must match a wrap already tied to the current ID.
DROP TRIGGER item_key_wraps_recovery_guard;
CREATE TRIGGER item_key_wraps_recovery_guard BEFORE INSERT ON item_key_wraps
WHEN NEW.wrapper = 'recovery'
  AND NEW.recovery_code_id IS NOT (SELECT binding_id FROM account_recovery_codes WHERE user_id = NEW.user_id)
  AND NOT EXISTS (
    SELECT 1 FROM item_key_wraps w JOIN account_recovery_codes a ON a.user_id = w.user_id
    WHERE w.user_id = NEW.user_id AND w.wrapper = 'recovery'
      AND (w.item_id = NEW.item_id OR w.item_id = (
        SELECT conflict_of FROM items WHERE user_id = NEW.user_id AND id = NEW.item_id
      ))
      AND w.kdf_salt = NEW.kdf_salt AND w.kdf_iterations = NEW.kdf_iterations
      AND w.iv = NEW.iv AND w.ciphertext = NEW.ciphertext AND w.generation = NEW.generation
      AND NEW.recovery_code_id IS NULL AND (a.rotation_nonce IS NULL OR w.recovery_code_id = a.binding_id)
  )
BEGIN SELECT RAISE(ABORT, 'recovery_code_binding_required'); END;

DROP TRIGGER topic_key_wraps_recovery_guard;
CREATE TRIGGER topic_key_wraps_recovery_guard BEFORE INSERT ON topic_key_wraps
WHEN NEW.wrapper = 'recovery'
  AND NEW.recovery_code_id IS NOT (SELECT binding_id FROM account_recovery_codes WHERE user_id = NEW.user_id)
  AND NOT EXISTS (
    SELECT 1 FROM topic_key_wraps w JOIN account_recovery_codes a ON a.user_id = w.user_id
    WHERE w.user_id = NEW.user_id AND w.topic_id = NEW.topic_id AND w.wrapper = 'recovery'
      AND w.kdf_salt = NEW.kdf_salt AND w.kdf_iterations = NEW.kdf_iterations
      AND w.iv = NEW.iv AND w.ciphertext = NEW.ciphertext AND w.generation = NEW.generation
      AND NEW.recovery_code_id IS NULL AND (a.rotation_nonce IS NULL OR w.recovery_code_id = a.binding_id)
  )
BEGIN SELECT RAISE(ABORT, 'recovery_code_binding_required'); END;
