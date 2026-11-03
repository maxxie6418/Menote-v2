import type { RaindropBindingView, RaindropPullOutcome, RaindropPushOutcome, RaindropPushPreview, RaindropStatusView } from "@menote/shared";

/** Raindrop 连接器 REST 客户端（TP9）：状态、令牌、绑定与手动拉取。错误消息来自服务端。 */

async function errorFrom(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return typeof body === "object" && body !== null && typeof Reflect.get(body, "error") === "string"
    ? String(Reflect.get(body, "error"))
    : fallback;
}

function validStatus(value: unknown): value is RaindropStatusView {
  if (typeof value !== "object" || value === null) return false;
  const status = value as Partial<RaindropStatusView>;
  return typeof status.settings === "object" && (status.runs ?? null) !== null
    && (status.binding === null || typeof status.binding === "object");
}

export async function readRaindropStatus(signal?: AbortSignal): Promise<RaindropStatusView | null> {
  const response = await fetch("/api/raindrop/status", { signal, cache: "no-store" });
  if (!response.ok) throw new Error(await errorFrom(response, "连接器状态读取失败"));
  const body: unknown = await response.json().catch(() => null);
  const status = typeof body === "object" && body !== null ? Reflect.get(body, "status") : undefined;
  return validStatus(status) ? status : null;
}

export async function saveRaindropToken(token: string): Promise<void> {
  const response = await fetch("/api/raindrop/token", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }), cache: "no-store",
  });
  if (!response.ok) throw new Error(await errorFrom(response, "令牌保存失败"));
}

export async function clearRaindropToken(): Promise<void> {
  const response = await fetch("/api/raindrop/token", { method: "DELETE", cache: "no-store" });
  if (!response.ok) throw new Error(await errorFrom(response, "令牌清除失败"));
}

export async function bindRaindropTable(input: {
  tableItemId: string; collectionId: number; pullIntervalHours: number;
}): Promise<RaindropBindingView> {
  const response = await fetch("/api/raindrop/bind", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input), cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(await errorFrom(response, "绑定失败"));
  const binding = typeof body === "object" && body !== null ? Reflect.get(body, "binding") : undefined;
  if (typeof binding !== "object" || binding === null) throw new Error("绑定响应格式无效");
  return binding as RaindropBindingView;
}

export async function unbindRaindropTable(): Promise<void> {
  const response = await fetch("/api/raindrop/unbind", { method: "POST", cache: "no-store" });
  if (!response.ok) throw new Error(await errorFrom(response, "解绑失败"));
}

export interface RaindropPullResult {
  pulledNew: number;
  pulledUpdated: number;
  conflicts: number;
  remoteMissing: number;
  orphans: number;
  skipped: number;
}

export async function pullRaindropNow(): Promise<RaindropPullResult> {
  const response = await fetch("/api/raindrop/pull", { method: "POST", cache: "no-store" });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(await errorFrom(response, "拉取失败"));
  const outcome = typeof body === "object" && body !== null ? Reflect.get(body, "outcome") : undefined;
  if (typeof outcome !== "object" || outcome === null) throw new Error("拉取响应格式无效");
  return outcome as RaindropPullResult;
}

function validPreview(value: unknown): value is RaindropPushPreview {
  if (typeof value !== "object" || value === null) return false;
  const preview = value as Partial<RaindropPushPreview>;
  return Array.isArray(preview.creates) && Array.isArray(preview.updates)
    && Array.isArray(preview.remoteMissing) && typeof preview.totalChanges === "number"
    && typeof preview.requiresConfirm === "boolean" && typeof preview.threshold === "number";
}

/** 推送差异预览（基于账本基线，不触远端）。 */
export async function previewRaindropPush(): Promise<RaindropPushPreview | null> {
  const response = await fetch("/api/raindrop/push/preview", { method: "POST", cache: "no-store" });
  if (!response.ok) throw new Error(await errorFrom(response, "预览失败"));
  const body: unknown = await response.json().catch(() => null);
  const preview = typeof body === "object" && body !== null ? Reflect.get(body, "preview") : undefined;
  return validPreview(preview) ? preview : null;
}

/** 执行反推推送；数量超过熔断阈值时服务端要求 confirm=true。 */
export async function pushRaindropNow(confirm: boolean): Promise<RaindropPushOutcome> {
  const response = await fetch("/api/raindrop/push", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm }), cache: "no-store",
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(await errorFrom(response, "推送失败"));
  const outcome = typeof body === "object" && body !== null ? Reflect.get(body, "outcome") : undefined;
  if (typeof outcome !== "object" || outcome === null) throw new Error("推送响应格式无效");
  return outcome as RaindropPushOutcome;
}
