import {
  AI_FREE_NEURONS_DAILY, AI_MAX_CONTENT_CHARS, AI_MAX_TITLE_CHARS, AI_SETTING_KEY, AI_MODEL_OPTIONS,
  DEFAULT_AI_MODEL, normalizeAiSettings, type AiSettings, type AiTaskKind, type AiTaskResult,
  type AiTaskStatus, type AiTaskView, type AiUsageSummary,
} from "@menote/shared";
import {
  addAiUsage, findActiveAiTask, findReusableAiTask, insertAiTask, readAiEligibleItem, readAiTask,
  readAiUsage, updateAiTaskOutcome,
} from "../db/ai";
import { readSettingState } from "../db/sync";

/** 队列消费失败重试上限；与 wrangler.jsonc consumers[].max_retries 保持一致。 */
export const AI_TASK_MAX_RETRIES = 3;
/** 提交正文上限（字符）：中文按 UTF-8 约 3 字节计，32k 字符在最坏情形下仍在队列 128KB 消息限制内。 */
const CONTENT_LIMIT = Math.min(AI_MAX_CONTENT_CHARS, 32_000);

export class AiServiceError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export interface AiQueueMessage {
  taskId: string;
  userId: string;
  kind: AiTaskKind;
  title: string;
  tags: string[];
  content: string;
}

export function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** AI 设置随 user_settings 同步（key 见 AI_SETTING_KEY）；缺记录或非法值回退默认。 */
export async function readAiSettings(db: D1Database, userId: string): Promise<AiSettings> {
  const setting = await readSettingState(db, userId, AI_SETTING_KEY);
  return normalizeAiSettings(setting?.sensitivity === "ordinary" ? setting.value : undefined);
}

export function aiBinding(env: Env): Ai | null {
  const value: unknown = Reflect.get(env, "AI");
  return value && typeof (value as Ai).run === "function" ? value as Ai : null;
}

export function aiQueue(env: Env): Queue | null {
  const value: unknown = Reflect.get(env, "AI_TASKS_QUEUE");
  return value && typeof (value as Queue).send === "function" ? value as Queue : null;
}

export interface AiSubmitInput { itemId: string; kind: AiTaskKind; title: string; tags: string[]; content: string; force?: boolean }

/** 提交推理任务：设置开关 → 条目守卫（加密排除）→ 结果复用 → 在途去重 → 预算闸门 → 入队（13.3/13.5-2）。 */
export async function submitAiTask(env: Env, userId: string, input: AiSubmitInput, now: number): Promise<AiTaskView> {
  const settings = await readAiSettings(env.DB, userId);
  if (!settings.enabled) throw new AiServiceError("AI 功能未启用，请在设置中开启", 409);
  const ai = aiBinding(env);
  if (!ai) throw new AiServiceError("AI 服务未配置（缺少 Workers AI 绑定）", 503);
  const queue = aiQueue(env);
  if (!queue) throw new AiServiceError("AI 任务队列未配置", 503);
  const { itemId, kind } = input;
  if (kind !== "summary" && kind !== "tags") throw new AiServiceError("未知的 AI 任务类型", 400);
  const title = typeof input.title === "string" ? input.title.slice(0, AI_MAX_TITLE_CHARS) : "";
  const tags = Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 64) : [];
  const content = typeof input.content === "string" ? input.content : "";
  if (!content.trim() || content.length > CONTENT_LIMIT) throw new AiServiceError(`正文为空或超出 ${CONTENT_LIMIT} 字符上限`, 400);
  const item = await readAiEligibleItem(env.DB, userId, itemId);
  if (!item) throw new AiServiceError("条目不存在、已删除或已加密；加密内容不提交云端 AI", 404);
  if (kind === "summary" && item.type !== "note") throw new AiServiceError("摘要仅支持正式笔记（Note）", 400);

  const contentHash = await sha256Hex(content);
  if (!input.force) {
    const reusable = await findReusableAiTask(env.DB, userId, itemId, kind, contentHash);
    if (reusable) return toView(reusable, true);
  }
  const active = await findActiveAiTask(env.DB, userId, itemId, kind, contentHash);
  if (active) return toView(active, false);

  const usage = await readAiUsage(env.DB, userId, dayKey(now));
  if (usage.calls >= settings.dailyCallLimit) {
    throw new AiServiceError(`已达今日 AI 调用上限（${settings.dailyCallLimit} 次/日，可在设置调整）`, 429);
  }

  const task = {
    id: crypto.randomUUID(), userId, itemId, kind, contentHash, model: settings.model,
    status: "queued" as AiTaskStatus, resultJson: null, error: null, inputTokens: null, outputTokens: null,
    createdAt: now, updatedAt: now,
  };
  await insertAiTask(env.DB, task);
  const message: AiQueueMessage = { taskId: task.id, userId, kind, title, tags, content };
  await queue.send(message);
  return toView(task, false);
}

function toView(row: { id: string; itemId: string; kind: AiTaskKind; status: AiTaskStatus; resultJson: string | null; error: string | null; createdAt: number; updatedAt: number }, reused: boolean): AiTaskView {
  let result: AiTaskResult | null = null;
  if (row.resultJson) {
    try {
      const parsed = JSON.parse(row.resultJson) as AiTaskResult;
      if (parsed?.type === "summary" || parsed?.type === "tags") result = parsed;
    } catch { /* 落库内容损坏时按无结果处理。 */ }
  }
  return { id: row.id, itemId: row.itemId, kind: row.kind, status: row.status, result, error: row.error, reused, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export async function readAiTaskView(db: D1Database, userId: string, id: string): Promise<AiTaskView | null> {
  const row = await readAiTask(db, userId, id);
  return row ? toView(row, false) : null;
}

export async function readAiUsageSummary(db: D1Database, userId: string, now: number): Promise<AiUsageSummary> {
  const [settings, usage] = await Promise.all([readAiSettings(db, userId), readAiUsage(db, userId, dayKey(now))]);
  return { day: dayKey(now), calls: usage.calls, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, dailyCallLimit: settings.dailyCallLimit, freeNeuronsDaily: AI_FREE_NEURONS_DAILY };
}

function buildMessages(kind: AiTaskKind, title: string, tags: string[], content: string): Array<{ role: "system" | "user"; content: string }> {
  const excerpt = content.length > CONTENT_LIMIT ? content.slice(0, CONTENT_LIMIT) : content;
  if (kind === "summary") {
    return [
      { role: "system", content: "你是中文笔记助手。用简体中文为笔记写一段 2~3 句的摘要，不超过 120 字，忠实原文、不加评论，不使用 Markdown 标记。" },
      { role: "user", content: `标题：${title || "无标题"}\n\n正文：\n${excerpt}` },
    ];
  }
  return [
    { role: "system", content: '你是中文笔记助手。根据笔记内容推荐 3~5 个简短标签（每个 2~12 字），优先从已有标签中选择相近的。只输出 JSON 字符串数组，如 ["标签1","标签2"]，不要输出任何其他文字。' },
    { role: "user", content: `标题：${title || "无标题"}\n已有标签：${tags.length ? tags.join("、") : "无"}\n\n正文：\n${excerpt}` },
  ];
}

interface ModelReply { response?: unknown; choices?: Array<{ message?: { content?: unknown } }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }

/** 去掉模型仍可能夹带的思考段，避免把推理过程当成概述或标签。 */
function answerText(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

async function callModel(ai: Ai, model: string, messages: Array<{ role: string; content: string }>): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const option = AI_MODEL_OPTIONS.find((entry) => entry.id === model);
  const maxTokens = option?.maxOutputTokens ?? 512;
  // GLM 默认 enable_thinking=true，512 token 会被思考占满、正文为空，概述和标签一起失败。
  // GLM 用 max_completion_tokens（max_tokens 已废弃）；其余按通用 max_tokens。
  const params: Record<string, unknown> = model.startsWith("@cf/zai-org/")
    ? { messages, max_completion_tokens: maxTokens, chat_template_kwargs: { enable_thinking: false } }
    : { messages, max_tokens: maxTokens };
  const reply = await ai.run(model, params) as ModelReply;
  const choice = reply.choices?.[0]?.message?.content;
  const raw = typeof choice === "string" && choice.trim() ? choice : typeof reply.response === "string" ? reply.response : "";
  const inputTokens = typeof reply.usage?.prompt_tokens === "number" ? reply.usage.prompt_tokens : 0;
  const outputTokens = typeof reply.usage?.completion_tokens === "number" ? reply.usage.completion_tokens : 0;
  return { text: answerText(raw), inputTokens, outputTokens };
}

export function parseTagRecommendation(text: string): string[] {
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let parsed: unknown = null;
  try { parsed = JSON.parse(stripped); } catch {
    const match = stripped.match(/\[[\s\S]*\]/);
    if (match) { try { parsed = JSON.parse(match[0]); } catch { parsed = null; } }
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry !== "string") continue;
    const tag = entry.trim().replace(/^#/, "").slice(0, 24);
    if (tag.length >= 1 && tag.length <= 24) seen.add(tag);
    if (seen.size >= 8) break;
  }
  return [...seen];
}

/** 队列消费者执行体：预算复查 → 推理 → 结果/失败落库（成功才计用量；可重试错误向上抛给队列重试）。 */
export async function runAiTask(env: Env, message: AiQueueMessage, attempts: number, now: number): Promise<void> {
  const task = await readAiTask(env.DB, message.userId, message.taskId);
  if (!task || task.status !== "queued") return;
  const settings = await readAiSettings(env.DB, message.userId);
  if (!settings.enabled) {
    await updateAiTaskOutcome(env.DB, task.id, "failed", { error: "AI 功能已停用" }, now);
    return;
  }
  const usage = await readAiUsage(env.DB, message.userId, dayKey(now));
  if (usage.calls >= settings.dailyCallLimit) {
    await updateAiTaskOutcome(env.DB, task.id, "failed", { error: "已达每日 AI 调用上限，任务未执行" }, now);
    return;
  }
  const ai = aiBinding(env);
  if (!ai) {
    await updateAiTaskOutcome(env.DB, task.id, "failed", { error: "AI 服务未配置" }, now);
    return;
  }
  const model = AI_MODEL_OPTIONS.some((option) => option.id === task.model) || /^@[a-z0-9][a-z0-9._/-]{1,120}$/i.test(task.model) ? task.model : DEFAULT_AI_MODEL;
  try {
    const reply = await callModel(ai, model, buildMessages(message.kind, message.title, message.tags, message.content));
    if (!reply.text) throw new Error("模型未返回内容");
    let result: AiTaskResult;
    if (message.kind === "summary") result = { type: "summary", summary: reply.text.slice(0, 2_000) };
    else {
      const tags = parseTagRecommendation(reply.text);
      if (!tags.length) throw new Error("无法从模型输出解析标签");
      result = { type: "tags", tags };
    }
    await updateAiTaskOutcome(env.DB, task.id, "done", {
      resultJson: JSON.stringify(result), inputTokens: reply.inputTokens, outputTokens: reply.outputTokens,
    }, now);
    await addAiUsage(env.DB, message.userId, dayKey(now), { calls: 1, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens });
  } catch (error) {
    if (attempts < AI_TASK_MAX_RETRIES) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    await updateAiTaskOutcome(env.DB, task.id, "failed", { error: detail.slice(0, 300) }, now);
  }
}

/** 队列入口：逐条显式 ack/retry（抛错不整批重试）；终态失败由 runAiTask 落库后正常 ack。 */
export async function dispatchAiQueue(env: Env, batch: MessageBatch<unknown>): Promise<void> {
  if (!env.DB) return;
  for (const message of batch.messages) {
    const body = message.body as Partial<AiQueueMessage>;
    if (!body || typeof body.taskId !== "string" || typeof body.userId !== "string" || typeof body.content !== "string") {
      message.ack();
      continue;
    }
    try {
      await runAiTask(env, body as AiQueueMessage, message.attempts, Date.now());
      message.ack();
    } catch {
      message.retry();
    }
  }
}
