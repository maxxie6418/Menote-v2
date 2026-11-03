// Shared contracts are the only source of types used by web and Worker.
export const applicationName = "Menote";
export type { Memo } from "./types/memo";
export type { TopicNode, User } from "./types/identity";
export type { SchemaMigration, SchemaStatus } from "./types/migration";
export type { HealthResponse } from "./contracts/health";
export type { AuthStatus, AuthUser, CredentialsInput } from "./contracts/auth";
export { USERNAME_MAX, PASSWORD_MIN, validUsername, validPassword } from "./contracts/auth";
export { DEFAULT_MONITOR_PREFERENCES } from "./contracts/monitor";
export {
  AI_SETTING_KEY, AI_MODEL_OPTIONS, DEFAULT_AI_MODEL, AI_FREE_NEURONS_DAILY,
  DEFAULT_AI_SETTINGS, normalizeAiSettings, AI_MAX_CONTENT_CHARS, AI_MAX_TITLE_CHARS,
} from "./contracts/ai";
export type {
  AiModelOption, AiSettings, AiTaskKind, AiTaskStatus, AiTaskResult, AiTaskView, AiUsageSummary,
} from "./contracts/ai";
export type { MonitorSummary, MonitorPoint, MonitorPreferences, CloudflareMonitorSetup, CloudflareMonitorConnection, CloudflareMonitorMetrics } from "./contracts/monitor";
export type { Item, StoredContent, Attachment, MemoComment, MemoQuote } from "./types/item";
export type {
  SyncTombstone, SyncPage, OutboxOperation, SyncEntity, SyncPushRequest,
  SyncConflictDetail, SyncOperationResult, SyncPushResponse, KeyWrap,
} from "./contracts/sync";
export type { ItemVersion, VersionSnapshot } from "./types/version";
export {
  MCP_PERMISSION_KEYS,
  type OpaqueCiphertext, type McpToken, type McpTokenView, type McpTokenConfig,
  type McpPermission, type McpTokenScope, type McpAudit, type BackupTarget,
  type McpClipRequest, type McpClipResult, type McpBookmarkRequest, type McpBookmarkResult,
  type McpMemoRequest, type McpMemoResult,
} from "./types/integrations";
export type { UserSetting, MonitorSample } from "./types/settings";
export { isClipTemplateV1 } from "./types/clipTemplate";
export type { ClipTemplateV1, ClipTemplateField, StoredClipTemplate } from "./types/clipTemplate";
