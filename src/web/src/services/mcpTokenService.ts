import type { McpTokenConfig, McpTokenView, TopicNode } from "@menote/shared";

async function responseJson<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error : `http_${response.status}`;
    throw new Error(error);
  }
  return body as T;
}

export async function listMcpTokens(): Promise<McpTokenView[]> {
  const body = await responseJson<{ tokens?: McpTokenView[] }>(await fetch("/api/mcp/tokens", { cache: "no-store" }));
  return Array.isArray(body.tokens) ? body.tokens : [];
}

export async function listMcpScopeTopics(): Promise<Array<Pick<TopicNode, "id" | "parentId" | "name" | "depth">>> {
  const body = await responseJson<{ topics?: Array<Pick<TopicNode, "id" | "parentId" | "name" | "depth">> }>(
    await fetch("/api/mcp/tokens/scopes", { cache: "no-store" }),
  );
  return Array.isArray(body.topics) ? body.topics : [];
}

export async function createMcpToken(config: McpTokenConfig): Promise<McpTokenView> {
  const body = await responseJson<{ token: McpTokenView }>(await fetch("/api/mcp/tokens", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config }),
  }));
  return body.token;
}

export async function updateMcpToken(id: string, config: McpTokenConfig): Promise<void> {
  await responseJson(await fetch(`/api/mcp/tokens/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config }),
  }));
}

export async function revealMcpToken(id: string): Promise<string> {
  const body = await responseJson<{ token: string }>(await fetch(`/api/mcp/tokens/${encodeURIComponent(id)}/reveal`, { cache: "no-store", method: "POST" }));
  return body.token;
}

export async function revokeMcpToken(id: string): Promise<void> {
  await responseJson(await fetch(`/api/mcp/tokens/${encodeURIComponent(id)}/revoke`, { method: "POST" }));
}
