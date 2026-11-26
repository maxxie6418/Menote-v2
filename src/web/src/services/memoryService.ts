import type { MemoryBindPreview, MemoryPluginStatus } from "@menote/shared";
import { requestSyncNow, flushSync } from "./syncEngine";

const messages: Record<string, string> = {
  table_unavailable: "这张表格不可用。请确认它已同步、未删除且位于普通空间。",
  table_already_bound: "这张表格已绑定 Raindrop。",
  preview_stale: "表格已更新，请重新预览。",
  binding_changed: "绑定已变更，请刷新配置。",
  invalid_rows: "表格包含无效记录，请检查预览结果。",
  memory_unavailable: "记忆库暂不可用。",
};

async function memoryRequest<T>(path: string, method = "GET", data?: object): Promise<T> {
  const response = await fetch(`/api/memory/${path}`, { method, cache: "no-store",
    ...(data && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }) });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body) throw new Error(messages[body?.error] ?? "请求失败，请重试。");
  return body as T;
}

export function readMemoryPlugin() { return memoryRequest<MemoryPluginStatus>("status"); }
export function updateMemoryPlugin(enabled: boolean) { return memoryRequest<MemoryPluginStatus>("enabled", "PUT", { enabled }); }

export async function previewMemoryTable(userId: string, tableId: string) {
  await flushSync(userId);
  return memoryRequest<MemoryBindPreview>("binding/preview", "POST", { tableId });
}

export async function bindMemoryTable(userId: string, preview: MemoryBindPreview) {
  const status = await memoryRequest<MemoryPluginStatus>("binding", "PUT", { tableId: preview.tableId, rev: preview.rev });
  void requestSyncNow(userId);
  return status;
}

export async function createMemoryTable(userId: string) {
  const status = await memoryRequest<MemoryPluginStatus>("binding/new", "POST");
  void requestSyncNow(userId);
  return status;
}

export function unbindMemoryTable(id: string) { return memoryRequest<MemoryPluginStatus>(`binding/${encodeURIComponent(id)}`, "DELETE"); }
