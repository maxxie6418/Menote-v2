import type { StoredClipTemplate, ClipTemplateV1 } from "@menote/shared";

export function emptyClipTemplateDraft(): string { return `{
  "schemaVersion": 1,
  "id": "${crypto.randomUUID()}",
  "name": "新剪藏规则",
  "enabled": false,
  "match": { "hosts": ["example.com"], "paths": ["/*"] },
  "selectors": { "title": { "selector": "h1", "value": "text" }, "content": { "selector": "article", "value": "html" } },
  "exclude": [],
  "source": { "kind": "manual" }
}`; }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", ...init?.headers } });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body && typeof body === "object" && "error" in body ? String(body.error) : `http_${response.status}`);
  return body as T;
}

export async function listClipTemplates(): Promise<StoredClipTemplate[]> {
  const result = await request<{ templates: StoredClipTemplate[] }>("/api/clip-templates");
  return result.templates;
}
export async function saveClipTemplate(template: ClipTemplateV1, expectedVersion?: number | null): Promise<void> {
  await request(`/api/clip-templates/${encodeURIComponent(template.id)}`, { method: "PUT", body: JSON.stringify({ template, expectedVersion }) });
}
export async function removeClipTemplate(id: string): Promise<void> {
  await request(`/api/clip-templates/${encodeURIComponent(id)}`, { method: "DELETE" });
}
