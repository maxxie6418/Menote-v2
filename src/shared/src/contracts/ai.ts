/** AI 助手契约（FR-AI-2 / 主文档 13.3）：设置随 user_settings 同步，任务与用量走独立 REST。 */

export const AI_SETTING_KEY = "ai";

export interface AiModelOption {
  /** Workers AI 目录模型标识，如 @cf/zai-org/glm-4.7-flash。 */
  id: string;
  label: string;
  maxOutputTokens: number;
}

/** 模型候选（FR-AI-2 双候选，保留替换能力）；目录可用性与 Neurons 定价以部署时核验为准（TP8 核验义务 ⑥）。 */
export const AI_MODEL_OPTIONS: readonly AiModelOption[] = [
  { id: "@cf/zai-org/glm-4.7-flash", label: "GLM-4.7-Flash", maxOutputTokens: 512 },
  { id: "@cf/qwen/qwen3-30b-a3b-fp8", label: "Qwen3-30B-A3B", maxOutputTokens: 512 },
];

export const DEFAULT_AI_MODEL = AI_MODEL_OPTIONS[0].id;

/** Workers AI 免费档参考额度（Neurons/日），仅作界面声明参考，以官方当期文档为准（NFR-5）。 */
export const AI_FREE_NEURONS_DAILY = 10_000;

export interface AiSettings {
  enabled: boolean;
  model: string;
  /** 每日推理调用上限（次），达限拒绝新任务（13.5-2 应用内预算）。 */
  dailyCallLimit: number;
}

export const DEFAULT_AI_SETTINGS: Readonly<AiSettings> = {
  enabled: false, model: DEFAULT_AI_MODEL, dailyCallLimit: 50,
};

const MODEL_ID_PATTERN = /^@[a-z0-9][a-z0-9._/-]{1,120}$/i;

/** 双端共用的设置归一：非法值回退默认（不抛出，设置面不可信）。 */
export function normalizeAiSettings(value: unknown): AiSettings {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Partial<AiSettings>;
  return {
    enabled: raw.enabled === true,
    model: typeof raw.model === "string" && MODEL_ID_PATTERN.test(raw.model) ? raw.model : DEFAULT_AI_SETTINGS.model,
    dailyCallLimit: typeof raw.dailyCallLimit === "number" && Number.isInteger(raw.dailyCallLimit)
      ? Math.min(500, Math.max(1, raw.dailyCallLimit))
      : DEFAULT_AI_SETTINGS.dailyCallLimit,
  };
}

export type AiTaskKind = "summary" | "tags";
export type AiTaskStatus = "queued" | "running" | "done" | "failed";

export type AiTaskResult =
  | { type: "summary"; summary: string }
  | { type: "tags"; tags: string[] };

export interface AiTaskView {
  id: string;
  itemId: string;
  kind: AiTaskKind;
  status: AiTaskStatus;
  result: AiTaskResult | null;
  error: string | null;
  /** 命中同内容已完成的复用结果时为 true（13.3 按 content_hash 复用）。 */
  reused: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AiUsageSummary {
  day: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  dailyCallLimit: number;
  /** 免费档参考值；界面必须标注「以官方为准」，不冒充账单。 */
  freeNeuronsDaily: number;
}

/** 提交推理的正文与标题上限（防御性，超限拒绝）。 */
export const AI_MAX_CONTENT_CHARS = 80_000;
export const AI_MAX_TITLE_CHARS = 300;
