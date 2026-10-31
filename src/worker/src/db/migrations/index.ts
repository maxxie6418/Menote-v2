import type { SchemaMigration } from "@menote/shared";
import initialMonitorSamples from "./0001_monitor_samples.sql";
import monitorSamplesIndex from "./0002_monitor_index.sql";
import users from "./0003_users.sql";
import topics from "./0004_topics.sql";
import items from "./0005_items.sql";
import attachments from "./0006_attachments.sql";
import monitorHourly from "./0007_monitor_hourly.sql";
import itemVersions from "./0008_item_versions.sql";
import versionInsertGuard from "./0009_version_insert_guard.sql";
import versionUpdateGuard from "./0010_version_update_guard.sql";
import itemEncryptionGuard from "./0011_item_encryption_guard.sql";
import mcpTokens from "./0012_mcp_tokens.sql";
import mcpAudit from "./0013_mcp_audit.sql";
import backupTargets from "./0014_backup_targets.sql";
import userSettings from "./0015_user_settings.sql";

// Published migrations must never be edited: append a new version instead.
export const migrations = [
  { version: 1, name: "0001_monitor_samples", statements: [initialMonitorSamples] },
  { version: 2, name: "0002_monitor_index", statements: [monitorSamplesIndex] },
  { version: 3, name: "0003_users", statements: [users] },
  { version: 4, name: "0004_topics", statements: [topics] },
  { version: 5, name: "0005_items", statements: [items] },
  { version: 6, name: "0006_attachments", statements: [attachments] },
  { version: 7, name: "0007_monitor_hourly", statements: [monitorHourly] },
  { version: 8, name: "0008_item_versions", statements: [itemVersions] },
  { version: 9, name: "0009_version_insert_guard", statements: [versionInsertGuard] },
  { version: 10, name: "0010_version_update_guard", statements: [versionUpdateGuard] },
  { version: 11, name: "0011_item_encryption_guard", statements: [itemEncryptionGuard] },
  { version: 12, name: "0012_mcp_tokens", statements: [mcpTokens] },
  { version: 13, name: "0013_mcp_audit", statements: [mcpAudit] },
  { version: 14, name: "0014_backup_targets", statements: [backupTargets] },
  { version: 15, name: "0015_user_settings", statements: [userSettings] },
] as const satisfies readonly SchemaMigration[];
