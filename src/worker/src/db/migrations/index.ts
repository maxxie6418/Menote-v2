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
import backupTargetName from "./0016_backup_target_name.sql";
import backupTargetEnabled from "./0017_backup_target_enabled.sql";
import userCredentials from "./0018_user_credentials.sql";
import appSettings from "./0019_app_settings.sql";
import sessions from "./0020_sessions.sql";
import loginThrottle from "./0021_login_throttle.sql";
import jobRuns from "./0022_job_runs.sql";
import syncEngine from "./0023_sync_engine.sql";
import keyWraps from "./0024_key_wraps.sql";
import backupTargetRemotePath from "./0025_backup_target_remote_path.sql";
import backupTargetRetention from "./0026_backup_target_retention.sql";
import backupTargetLastPushedAt from "./0027_backup_target_last_pushed_at.sql";
import monitorCloudflareCredentials from "./0028_monitor_cloudflare_credentials.sql";
import mcpTokenManagement from "./0029_mcp_token_management.sql";

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
  { version: 16, name: "0016_backup_target_name", statements: [backupTargetName] },
  { version: 17, name: "0017_backup_target_enabled", statements: [backupTargetEnabled] },
  { version: 18, name: "0018_user_credentials", statements: [userCredentials] },
  { version: 19, name: "0019_app_settings", statements: [appSettings] },
  { version: 20, name: "0020_sessions", statements: [sessions] },
  { version: 21, name: "0021_login_throttle", statements: [loginThrottle] },
  { version: 22, name: "0022_job_runs", statements: [jobRuns] },
  { version: 23, name: "0023_sync_engine", statements: [syncEngine] },
  { version: 24, name: "0024_key_wraps", statements: [keyWraps] },
  { version: 25, name: "0025_backup_target_remote_path", statements: [backupTargetRemotePath] },
  { version: 26, name: "0026_backup_target_retention", statements: [backupTargetRetention] },
  { version: 27, name: "0027_backup_target_last_pushed_at", statements: [backupTargetLastPushedAt] },
  { version: 28, name: "0028_monitor_cloudflare_credentials", statements: [monitorCloudflareCredentials] },
  { version: 29, name: "0029_mcp_token_management", statements: [mcpTokenManagement] },
] as const satisfies readonly SchemaMigration[];
