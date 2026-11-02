import type { AiTaskKind, AiTaskView, AiUsageSummary } from "@menote/shared";

/** AI 助手 REST 客户端（FR-AI-2）：任务提交/轮询与当日用量。错误消息来自服务端中文文案。 */

async function errorFrom(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return typeof body === "object" && body !== null && typeof Reflect.get(body, "error") === "string"
    ? String(Reflect.get(body, "error"))
    : fallback;
}

function validTask(value: unknown): value is AiTaskView {
  if (typeof value !== "object" || value === null) return false;
  const task = value as Partial<AiTaskView>;
  return typeof task.id === "string" && typeof task.itemId === "string"
    && (task.kind === "summary" || task.kind === "tags")
    && (task.status === "queued" || task.status === "running" || task.status === "done" || task.status === "failed")
    && typeof task.reused === "boolean";
}

export async function submitAiTask(input: { itemId: string; kind: AiTaskKind; title: string; tags: string[]; content: string; force?: boolean }): Promise<AiTaskView> {
  const response = await fetch("/api/ai/tasks", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input), cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(await errorFrom(response, "AI 任务提交失败"));
  const task = typeof body === "object" && body !== null ? Reflect.get(body, "task") : undefined;
  if (!validTask(task)) throw new Error("AI 任务响应格式无效");
  return task;
}

export async function readAiTask(id: string, signal?: AbortSignal): Promise<AiTaskView | null> {
  const response = await fetch(`/api/ai/tasks/${encodeURIComponent(id)}`, { signal, cache: "no-store" });
  if (response.status === 404) return null;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(await errorFrom(response, "AI 任务查询失败"));
  const task = typeof body === "object" && body !== null ? Reflect.get(body, "task") : undefined;
  return validTask(task) ? task : null;
}

/** 轮询到终态或超时；未决返回 null。间隔 1.5s，默认上限 90s（队列重试可能跨分钟）。 */
export async function pollAiTask(id: string, timeoutMs = 90_000, signal?: AbortSignal): Promise<AiTaskView | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await readAiTask(id, signal);
    if (task && (task.status === "done" || task.status === "failed")) return task;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    if (signal?.aborted) return null;
  }
  return null;
}

function validUsage(value: unknown): value is AiUsageSummary {
  if (typeof value !== "object" || value === null) return false;
  const usage = value as Partial<AiUsageSummary>;
  const count = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(usage.day)) && count(usage.calls) && count(usage.inputTokens)
    && count(usage.outputTokens) && count(usage.dailyCallLimit) && count(usage.freeNeuronsDaily);
}

export async function readAiUsage(signal?: AbortSignal): Promise<AiUsageSummary | null> {
  const response = await fetch("/api/ai/usage", { signal, cache: "no-store" });
  if (!response.ok) return null;
  const body: unknown = await response.json().catch(() => null);
  const usage = typeof body === "object" && body !== null ? Reflect.get(body, "usage") : undefined;
  return validUsage(usage) ? usage : null;
}
