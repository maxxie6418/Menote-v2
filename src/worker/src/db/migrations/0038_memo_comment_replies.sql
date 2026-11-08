ALTER TABLE memo_comments ADD COLUMN parent_id TEXT;

CREATE TRIGGER memo_comments_validate_parent_insert BEFORE INSERT ON memo_comments
WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM memo_comments parent
  WHERE parent.user_id = NEW.user_id AND parent.id = NEW.parent_id
    AND parent.memo_id = NEW.memo_id AND parent.parent_id IS NULL
    AND (parent.deleted_at IS NULL OR NEW.deleted_at IS NOT NULL)
)
BEGIN SELECT RAISE(ABORT, 'memo_comment_parent_invalid'); END;

CREATE TRIGGER memo_comments_validate_parent_update BEFORE UPDATE OF user_id, memo_id, parent_id ON memo_comments
WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM memo_comments parent
  WHERE parent.user_id = NEW.user_id AND parent.id = NEW.parent_id
    AND parent.memo_id = NEW.memo_id AND parent.parent_id IS NULL
    AND (parent.deleted_at IS NULL OR NEW.deleted_at IS NOT NULL)
)
BEGIN SELECT RAISE(ABORT, 'memo_comment_parent_invalid'); END;
