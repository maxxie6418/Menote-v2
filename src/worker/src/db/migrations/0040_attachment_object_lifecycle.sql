ALTER TABLE attachments ADD COLUMN r2_key TEXT;
ALTER TABLE attachments ADD COLUMN retired_at INTEGER;

CREATE TABLE attachment_object_deletions (
  object_key TEXT PRIMARY KEY NOT NULL,
  delete_after INTEGER NOT NULL,
  claimed INTEGER NOT NULL DEFAULT 0 CHECK (claimed IN (0, 1))
);
CREATE TABLE attachment_item_refs (
  user_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  item_id TEXT NOT NULL,
  PRIMARY KEY (user_id, sha256, item_id)
) WITHOUT ROWID;

CREATE INDEX idx_attachment_item_refs_item
  ON attachment_item_refs (user_id, item_id);

CREATE INDEX idx_attachment_object_deletions_due
  ON attachment_object_deletions (delete_after, object_key);

INSERT OR IGNORE INTO attachment_item_refs (user_id, sha256, item_id)
SELECT items.user_id, ref.value, items.id FROM items, json_each(items.attachment_hashes_json) AS ref
WHERE ref.type = 'text';

-- Historical ref_count excluded trash. Start the transition with a full observation
-- window when the true date of the last reference is unknown.
UPDATE attachments
SET r2_key = CASE WHEN size > 0 THEN user_id || '/' || sha256 END,
    orphaned_at = CASE
  WHEN EXISTS (
    SELECT 1 FROM attachment_item_refs
    WHERE user_id = attachments.user_id AND sha256 = attachments.sha256
  ) THEN NULL
  ELSE CAST(strftime('%s', 'now') AS INTEGER) * 1000
END;

CREATE INDEX idx_attachments_orphaned
  ON attachments (orphaned_at)
  WHERE retired_at IS NULL AND r2_key IS NOT NULL AND orphaned_at IS NOT NULL;
CREATE INDEX idx_attachments_live_page
  ON attachments (user_id, sha256)
  WHERE retired_at IS NULL;

-- Drive the guard from this item's JSON array so an ordinary sync never scans the user's attachments.
CREATE TRIGGER attachment_reference_guard_insert BEFORE INSERT ON items
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.attachment_hashes_json) AS ref
  CROSS JOIN attachments ON attachments.user_id = NEW.user_id AND attachments.sha256 = ref.value
  WHERE attachments.retired_at IS NOT NULL
)
BEGIN SELECT RAISE(ABORT, 'attachment_retired'); END;

CREATE TRIGGER attachment_reference_guard_update BEFORE UPDATE OF attachment_hashes_json ON items
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.attachment_hashes_json) AS ref
  CROSS JOIN attachments ON attachments.user_id = NEW.user_id AND attachments.sha256 = ref.value
  WHERE attachments.retired_at IS NOT NULL
)
BEGIN SELECT RAISE(ABORT, 'attachment_retired'); END;

CREATE TRIGGER attachment_orphan_clock_insert AFTER INSERT ON items
BEGIN
  INSERT OR IGNORE INTO attachment_item_refs (user_id, sha256, item_id)
  SELECT NEW.user_id, ref.value, NEW.id FROM json_each(NEW.attachment_hashes_json) AS ref WHERE ref.type = 'text';
  UPDATE attachments SET orphaned_at = NULL
  WHERE user_id = NEW.user_id AND orphaned_at IS NOT NULL
    AND sha256 IN (SELECT value FROM json_each(NEW.attachment_hashes_json));
END;

CREATE TRIGGER attachment_orphan_clock_update AFTER UPDATE OF attachment_hashes_json ON items
WHEN NEW.attachment_hashes_json <> OLD.attachment_hashes_json
BEGIN
  DELETE FROM attachment_item_refs WHERE user_id = OLD.user_id AND item_id = OLD.id;
  INSERT OR IGNORE INTO attachment_item_refs (user_id, sha256, item_id)
  SELECT NEW.user_id, ref.value, NEW.id FROM json_each(NEW.attachment_hashes_json) AS ref WHERE ref.type = 'text';
  UPDATE attachments SET orphaned_at = NULL
  WHERE user_id = NEW.user_id AND orphaned_at IS NOT NULL
    AND sha256 IN (SELECT value FROM json_each(NEW.attachment_hashes_json));
  UPDATE attachments SET orphaned_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE user_id = OLD.user_id AND retired_at IS NULL
    AND sha256 IN (SELECT value FROM json_each(OLD.attachment_hashes_json))
    AND NOT EXISTS (
      SELECT 1 FROM attachment_item_refs
      WHERE user_id = attachments.user_id AND sha256 = attachments.sha256
    );
END;

CREATE TRIGGER attachment_orphan_clock_delete AFTER DELETE ON items
BEGIN
  DELETE FROM attachment_item_refs WHERE user_id = OLD.user_id AND item_id = OLD.id;
  UPDATE attachments SET orphaned_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
  WHERE user_id = OLD.user_id AND retired_at IS NULL
    AND sha256 IN (SELECT value FROM json_each(OLD.attachment_hashes_json))
    AND NOT EXISTS (
      SELECT 1 FROM attachment_item_refs
      WHERE user_id = attachments.user_id AND sha256 = attachments.sha256
    );
END;

-- Old keys cannot be published again. Keep replaced keys for a day so concurrent
-- readers of the previous generation can finish.
CREATE TRIGGER attachment_enqueue_replaced BEFORE UPDATE OF r2_key, retired_at ON attachments
WHEN OLD.r2_key IS NOT NULL AND OLD.retired_at IS NULL
  AND (NEW.retired_at IS NOT NULL OR OLD.r2_key IS NOT NEW.r2_key)
BEGIN
  INSERT INTO attachment_object_deletions (object_key, delete_after, claimed)
  VALUES (OLD.r2_key, COALESCE(NEW.retired_at, CAST(strftime('%s', 'now') AS INTEGER) * 1000 + 86400000), 1);
END;
