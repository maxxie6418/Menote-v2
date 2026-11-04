/** Raindrop 连接器契约（FR-EXT-3 / 主文档 7.x v0.24）：插件开关随 user_settings 同步；
 *  绑定、令牌密文与同步账本走独立 REST + D1 表，不进 Markdown（行 ID 列除外，7.3 定稿）。 */

export const RAINDROP_SETTING_KEY = "raindrop";

export interface RaindropSettings {
  /** 插件开关：关闭时隐藏设置页、定时拉取跳过、路由 fail-closed；不影响应用其余功能。 */
  enabled: boolean;
}

/** Raindrop 收藏夹选项：API 响应归一后供设置页下拉选择。 */
export interface RaindropCollectionOption {
  id: number;
  title: string;
}

export const DEFAULT_RAINDROP_SETTINGS: Readonly<RaindropSettings> = { enabled: false };

/** 双端共用的设置归一：非法值回退默认（不抛出，设置面不可信）。 */
export function normalizeRaindropSettings(value: unknown): RaindropSettings {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Partial<RaindropSettings>;
  return { enabled: raw.enabled === true };
}

/** 绑定表格的「行 ID」列：本地行与 D1 账本的唯一锚点（唯一写入 Markdown 的技术列，主文档 7.3 v0.24）。 */
export const BOOKMARK_ROW_ID_COLUMN = "行 ID";

export interface BookmarkColumnDef {
  name: string;
  type: "text" | "link" | "multiselect" | "select" | "date" | "checkbox";
  options?: readonly string[];
}

/** 收藏标准列（FR-EXT-2 字段对齐 Raindrop）；插件写入与连接器拉取共用，保证同一张表结构一致。 */
export const BOOKMARK_COLUMNS: readonly BookmarkColumnDef[] = [
  { name: "标题", type: "text" },
  { name: "网址", type: "link" },
  { name: "摘要", type: "text" },
  { name: "备注", type: "text" },
  { name: "标签", type: "multiselect" },
  { name: "类型", type: "select", options: ["link", "article", "image", "video", "document", "audio"] },
  { name: "封面", type: "link" },
  { name: "采集时间", type: "date" },
  { name: "重要", type: "checkbox" },
];

/** 与标准列一一对应的映射字段（拉取基线与推送 diff 的比较单位）。 */
export interface RaindropMappedFields {
  title: string;
  link: string;
  excerpt: string;
  note: string;
  tags: string[];
  type: string;
  cover: string;
  capturedAt: string;
  important: boolean;
}

/** 拉取频率档位（小时）：绑定级可调；cron 每小时触发，按档位判断是否到期。 */
export const RAINDROP_INTERVAL_HOURS = [1, 6, 24] as const;

/** 远端原始 JSON 快照在 R2 的保留份数（风险兜底，主文档 7.5 v0.24）。 */
export const RAINDROP_SNAPSHOT_KEEP = 100;

/** 单次拉取的远端条目防御上限（超出即失败，防误配全库拖垮表格）。 */
export const RAINDROP_MAX_REMOTE_ITEMS = 20_000;

/** 推送熔断下限：待推条数超过 max(该值, 绑定行数一半) 时必须二次确认。 */
export const RAINDROP_PUSH_CONFIRM_MIN = 20;

export interface RaindropBindingView {
  tableItemId: string | null;
  collectionId: number;
  pullIntervalHours: number;
  hasToken: boolean;
  createdAt: number | null;
  updatedAt: number | null;
  lastPullAt: number | null;
  lastPushAt: number | null;
  lastSnapshotAt: number | null;
}

export type RaindropRunStatus = "ok" | "partial" | "failed";

export interface RaindropSyncRunView {
  id: number;
  direction: "pull" | "push";
  source: "scheduled" | "manual";
  startedAt: number;
  finishedAt: number;
  status: RaindropRunStatus;
  pulledNew: number;
  pulledUpdated: number;
  conflicts: number;
  remoteMissing: number;
  orphans: number;
  pushCreated: number;
  pushUpdated: number;
  pushFailed: number;
  detail: string | null;
}

export interface RaindropStatusView {
  settings: RaindropSettings;
  hasToken: boolean;
  binding: RaindropBindingView | null;
  runs: RaindropSyncRunView[];
}

/** 拉取结果（runPull 返回 / REST 回执）。 */
export interface RaindropPullOutcome {
  pulledNew: number;
  pulledUpdated: number;
  conflicts: number;
  remoteMissing: number;
  orphans: number;
  skipped: number;
}

/** 推送（阶段 B）：手动预览确认后反推远端；不提供远端删除，远端已消失的行默认不重建。 */
export interface RaindropPushOutcome {
  pushCreated: number;
  pushUpdated: number;
  conflicts: number;
  pushFailed: number;
  skipped: number;
}

export interface RaindropPushPreviewCreate {
  rowId: string;
  title: string;
  link: string;
}

export interface RaindropPushPreviewUpdate {
  rowId: string;
  raindropId: string;
  title: string;
  link: string;
  /** 将推送的字段键（title/link/excerpt/note/tags/cover/capturedAt/important）。 */
  diffKeys: string[];
}

export interface RaindropPushPreviewMissing {
  rowId: string;
  raindropId: string;
  title: string;
}

export interface RaindropPushPreview {
  creates: RaindropPushPreviewCreate[];
  updates: RaindropPushPreviewUpdate[];
  remoteMissing: RaindropPushPreviewMissing[];
  totalChanges: number;
  requiresConfirm: boolean;
  threshold: number;
}
