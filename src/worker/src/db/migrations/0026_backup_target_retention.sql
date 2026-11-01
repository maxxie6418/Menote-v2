ALTER TABLE backup_targets ADD COLUMN retention_count INTEGER NOT NULL DEFAULT 0 CHECK (retention_count >= 0);
