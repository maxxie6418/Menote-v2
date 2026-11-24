import { asBytes, extractTags, resolveItemId, type Item, type McpCreateItemRequest, type McpItemQuery, type McpToken } from "@menote/shared";
import { findMcpItems, listMcpFolders, listMcpVersions, readMcpItem, readMcpVersion } from "../db/mcpAgent";
import { appendMcpAudit } from "../db/mcpAudit";
import { findTable, splitFrontmatter } from "./tableMarkdown";
import { insertServerItem } from "./syncService";

function pageOf<T extends { id: string }>(rows: T[], limit: number) {
  return { rows: rows.slice(0, limit), next_cursor: rows.length > limit ? rows[limit - 1]!.id : null };
}

export async function queryAgentItems(db: D1Database, token: McpToken, input: McpItemQuery & { limit: number }) {
  return pageOf(await findMcpItems(db, token, input, input.cursor ?? "", input.limit + 1), input.limit);
}

export async function getAgentFolders(db: D1Database, token: McpToken, cursor: string | undefined, limit: number) {
  return pageOf(await listMcpFolders(db, token, cursor ?? "", limit + 1), limit);
}

export async function getAgentItem(db: D1Database, token: McpToken, id: string, cursor: string | undefined, maxChars: number) {
  const [revision, start] = cursor?.split(":").map(Number) ?? [undefined, 0];
  const offset = start ?? 0;
  const item = await readMcpItem(db, token, resolveItemId(id), offset, maxChars + 1, token.permissions.includes("attachment:access"));
  if (!item) return { error: "item_unavailable" as const };
  if (item.encrypted) return { value: item };
  if (revision !== undefined && revision !== item.rev) return { error: "item_changed" as const };
  const chars = Array.from(item.content);
  const next = chars.length > maxChars ? `${item.rev}:${offset + maxChars}` : null;
  return { value: { ...item, content: chars.slice(0, maxChars).join(""), next_cursor: next } };
}

export async function getAgentVersions(db: D1Database, token: McpToken, id: string, cursor: string | undefined, limit: number) {
  const itemId = resolveItemId(id);
  const item = await readMcpItem(db, token, itemId, 0, 0, false);
  if (!item || item.encrypted) return null;
  return pageOf(await listMcpVersions(db, token, itemId, cursor ?? "", limit + 1), limit);
}

async function decodeSnapshot(snapshot: unknown, codec: "identity" | "gzip"): Promise<string> {
  if (codec === "identity" && typeof snapshot === "string") return snapshot;
  const bytes = asBytes(snapshot);
  if (!bytes) throw new Error("invalid_snapshot");
  const text = new TextDecoder("utf-8", { fatal: true });
  if (codec === "identity") return text.decode(bytes);
  const source = new Blob([new Uint8Array(bytes)]).stream();
  const reader = source.pipeThrough(new DecompressionStream("gzip")).getReader();
  let size = 0;
  let result = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return result + text.decode();
    size += value.byteLength;
    if (size > 2_000_000) {
      await reader.cancel();
      throw new Error("snapshot_too_large");
    }
    result += text.decode(value, { stream: true });
  }
}

export async function getAgentVersion(
  db: D1Database, token: McpToken, id: string, versionId: string, cursor: string | undefined, maxChars: number,
) {
  const itemId = resolveItemId(id);
  const row = await readMcpVersion(db, token, itemId, versionId);
  if (!row) return { error: "version_unavailable" };
  try {
    const snapshot = await decodeSnapshot(row.snapshot_plain, row.codec);
    const offset = Number(cursor?.split(":")[1] ?? 0);
    const chars = Array.from(snapshot).slice(offset, offset + maxChars + 1);
    return { value: { id: itemId, version_id: row.id, content: chars.slice(0, maxChars).join(""),
      next_cursor: chars.length > maxChars ? `0:${offset + maxChars}` : null } };
  } catch {
    return { error: "version_unavailable" };
  }
}

async function createAgentItem(db: D1Database, token: McpToken, input: McpCreateItemRequest, now: number) {
  const markdown = input.content.trim();
  const title = input.title?.trim();
  if (!markdown || (input.type === "memo" ? Boolean(title) : !title) ||
      (input.type !== "memo" && input.task?.status) ||
      (input.type === "table" && !findTable(splitFrontmatter(markdown).body))) {
    throw new Error("invalid_agent_item");
  }
  if (input.type === "memo" && !token.includeMemos) throw new Error("memo_permission_missing");
  const contentHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(markdown))),
    (byte) => byte.toString(16).padStart(2, "0")).join("");
  const item: Item = {
    id: input.operation_id, userId: token.userId,
    ...(input.type === "memo" ? { type: input.type, title: null } : { type: input.type, title: title! }),
    content: { scope: "plain", markdown }, contentHash, topicId: null, groupId: null, attachmentHashes: [],
    tags: [...new Set([...(input.tags ?? []), ...(input.type === "memo" ? extractTags(markdown) : [])])].slice(0, 100),
    source: "agent", status: input.task?.status ?? null,
    rev: 1, metaRev: 1, pinned: false, starred: false, createdAt: now, updatedAt: now, deletedAt: null,
  };
  return insertServerItem({ db, userId: token.userId, deviceId: `mcp:${token.id}`, now }, item, input.operation_id);
}

export async function createAuditedAgentItem(db: D1Database, token: McpToken, input: McpCreateItemRequest, now: number) {
  const audit = { id: crypto.randomUUID(), userId: token.userId, tokenId: token.id, tool: "create_item",
    operationId: input.operation_id, revBefore: null, at: now };
  let created;
  try {
    created = await createAgentItem(db, token, input, now);
  } catch (error) {
    const expected = ["invalid_agent_item", "memo_permission_missing", "operation_conflict"];
    const code = error instanceof Error && expected.includes(error.message) ? error.message : "agent_create_failed";
    await appendMcpAudit(db, { ...audit, itemId: null, revAfter: null, result: code });
    return { error: code };
  }
  await appendMcpAudit(db, { ...audit, itemId: created.itemId, revAfter: created.rev, result: created.result });
  return { value: { id: created.itemId, rev: created.rev, result: created.result } };
}
