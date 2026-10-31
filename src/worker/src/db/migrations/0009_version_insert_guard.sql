CREATE TRIGGER version_insert_guard BEFORE INSERT ON item_versions
WHEN NEW.encrypted = 0 AND EXISTS (
  SELECT 1 FROM items WHERE user_id = NEW.user_id AND id = NEW.item_id
    AND (enc_self = 1 OR in_enc_space = 1)
)
BEGIN SELECT RAISE(ABORT, 'encrypted history required'); END
