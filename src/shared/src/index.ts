// Shared contracts are the only source of types used by web and Worker.
export const applicationName = "Menote";
export type { AccountArchiveSummary } from "./contracts/accountArchive";
export type { Memo } from "./types/memo";
export type { TopicNode, User } from "./types/identity";
export type { SchemaMigration, SchemaStatus } from "./types/migration";
export type { HealthResponse } from "./contracts/health";
export type { AuthStatus, AuthUser, CredentialsInput } from "./contracts/auth";
export { USERNAME_MAX, PASSWORD_MIN, validUsername, validPassword } from "./contracts/auth";
export {
  MOBILE_API, MOBILE_CAPTURE_MAX_CHARS,
  type MobileApiInfo, type MobileCaptureRequest, type MobileCaptureResult, type MobileLoginResult,
} from "./contracts/mobile";
export { DEFAULT_MONITOR_PREFERENCES } from "./contracts/monitor";
export {
  AI_SETTING_KEY, AI_MODEL_OPTIONS, DEFAULT_AI_MODEL, AI_FREE_NEURONS_DAILY,
  DEFAULT_AI_SETTINGS, normalizeAiSettings, AI_MAX_CONTENT_CHARS, AI_MAX_TITLE_CHARS,
} from "./contracts/ai";
export type {
  AiModelOption, AiSettings, AiTaskKind, AiTaskStatus, AiTaskResult, AiTaskView, AiUsageSummary,
} from "./contracts/ai";
export type { MonitorSummary, MonitorPoint, MonitorPreferences } from "./contracts/monitor";
export type { Item, StoredContent, Attachment, AttachmentPage, MemoComment, MemoQuote } from "./types/item";
export type {
  SyncTombstone, SyncPage, OutboxOperation, SyncEntity, SyncPushRequest,
  SyncConflictDetail, SyncOperationResult, SyncPushResponse, KeyWrap, RecoveryCodeBinding, RecoveryCodeState,
} from "./contracts/sync";
export type { ItemVersion, VersionSnapshot } from "./types/version";
export {
  parseRecoveryCodeBinding, parseRecoveryCodeRotation,
  type RecoveryCodeRotationRequest, type RecoveryCodeRotationState, type RecoveryCodeRotationWrap,
} from "./contracts/recoveryCode";
export { SEALED_ATTACHMENT_MIME, SEALED_ATTACHMENT_MAGIC, SEALED_ATTACHMENT_MIME_BYTES,
  SEALED_ATTACHMENT_IV_BYTES, SEALED_ATTACHMENT_OVERHEAD, isSealedAttachment } from "./contracts/sealedAttachment";
export {
  MCP_PERMISSION_KEYS, MCP_CLIP_MAX_ATTACHMENTS,
  type OpaqueCiphertext, type McpToken, type McpTokenView, type McpTokenConfig,
  DEFAULT_BACKUP_RETENTION, MAX_BACKUP_RETENTION, type RemoteBackup, type RemoteBackupPushResult,
  type McpPermission, type McpTokenScope, type McpAudit, type BackupTarget,
  type McpClipRequest, type McpClipResult, type McpBookmarkRequest, type McpBookmarkResult,
  type McpMemoRequest, type McpMemoResult,
} from "./types/integrations";
export type { UserSetting, MonitorSample } from "./types/settings";
export { isClipTemplateV1 } from "./types/clipTemplate";
export type { ClipTemplateV1, ClipTemplateField, StoredClipTemplate } from "./types/clipTemplate";
export { resolveItemId } from "./itemId";
export type { McpItemSummary, McpItemQuery, McpCreateItemRequest } from "./contracts/mcpAgent";
export { extractTags, findMemoTagRanges, appendTags, toggleTagInText, removeTagFromText, renameTagInText, setTagsInText } from "./memoTags";
export { bytesToBase64, base64ToBytes, asBytes, encodeBackupRow, decodeBackupRow, wrapFieldToBase64 } from "./bytes";
export { PROPERTY_TEMPLATES_SETTING_KEY } from "./contracts/propertyTemplates";
export {
  TABLE_VIEW_SETTING_KEY, DEFAULT_TABLE_VIEW_SETTINGS, normalizeTableViewSettings,
} from "./contracts/tableView";
export type { TableViewSettings } from "./contracts/tableView";
export {
  RAINDROP_SETTING_KEY, DEFAULT_RAINDROP_SETTINGS, normalizeRaindropSettings,
  BOOKMARK_ROW_ID_COLUMN, BOOKMARK_COLUMNS, RAINDROP_INTERVAL_HOURS,
  RAINDROP_SNAPSHOT_KEEP, RAINDROP_MAX_REMOTE_ITEMS, RAINDROP_PUSH_CONFIRM_MIN,
} from "./contracts/raindrop";
export type {
  RaindropSettings, RaindropCollectionOption, BookmarkColumnDef, RaindropMappedFields,
  RaindropBindingView, RaindropRunStatus, RaindropSyncRunView, RaindropStatusView,
  RaindropPullOutcome, RaindropPushOutcome, RaindropPushPreview, RaindropPushPreviewCreate,
  RaindropPushPreviewUpdate, RaindropPushPreviewMissing,
} from "./contracts/raindrop";
export * from "./contracts/memory";
export { decodeGfmTableRow, escapeGfmTablePipes } from "./gfmTableRow";
