CREATE TRIGGER item_encryption_guard BEFORE UPDATE OF enc_self, in_enc_space ON items
WHEN (NEW.enc_self = 1 OR NEW.in_enc_space = 1) AND EXISTS (
  SELECT 1 FROM item_versions WHERE user_id = NEW.user_id AND item_id = NEW.id AND encrypted = 0
)
BEGIN SELECT RAISE(ABORT, 'encrypt history before item'); END
