ALTER TABLE mcp_tokens ADD COLUMN name TEXT NOT NULL DEFAULT '';

UPDATE mcp_tokens AS target
SET name = 'menote' || (
  SELECT COUNT(*)
  FROM mcp_tokens AS previous
  WHERE previous.user_id = target.user_id
    AND (
      previous.created_at < target.created_at
      OR (previous.created_at = target.created_at AND previous.id <= target.id)
    )
);
