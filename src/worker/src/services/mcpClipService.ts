import { MCP_CLIP_MAX_ATTACHMENTS, SEALED_ATTACHMENT_MIME, type Item, type McpClipRequest, type McpClipResult } from "@menote/shared";
import { verifyMcpClipAttachments } from "../db/mcpAudit";
import { readSyncOperation } from "../db/sync";
import { insertServerItem } from "./syncService";

const MAX_TITLE_LENGTH = 500;
const MAX_MARKDOWN_LENGTH = 900_000;
const META_KEYS = ["author", "publishedAt", "siteName", "description", "canonicalUrl"] as const;

export interface McpClipContext { db: SqlDatabase; userId: string; tokenId: string; now: number }

function isWebUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; }
  catch { return false; }
}

/** JSON double-quoted scalars are valid YAML 1.2 and avoid a new serializer dependency. */
function yamlScalar(value: string): string { return JSON.stringify(value); }

function buildClipMarkdown(input: McpClipRequest): string {
  const lines = ["---", `page_title: ${yamlScalar(input.title)}`, `source_url: ${yamlScalar(input.sourceUrl)}`,
    `clipped_at: ${yamlScalar(input.capturedAt)}`];
  for (const key of META_KEYS) {
    const value = input.metadata[key];
    if (typeof value === "string" && value.trim()) lines.push(`${key === "publishedAt" ? "published_at" : key === "siteName" ? "site_name" : key === "canonicalUrl" ? "canonical_url" : key}: ${yamlScalar(value.trim())}`);
  }
  if (input.note?.trim()) lines.push(`clip_note: ${yamlScalar(input.note.trim())}`);
  return `${lines.join("\n")}\n---\n\n${input.markdown.trim()}`;
}

function hex(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createClipNote(ctx: McpClipContext, input: McpClipRequest): Promise<McpClipResult> {
  const title = input.title.trim();
  const body = input.markdown.trim();
  const capturedAt = Date.parse(input.capturedAt);
  const attachmentHashes = [...new Set(input.attachmentHashes ?? [])];
  if (input.schemaVersion !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.operationId) ||
      !title || title.length > MAX_TITLE_LENGTH || !body || body.length > MAX_MARKDOWN_LENGTH ||
      !isWebUrl(input.sourceUrl) || !Number.isFinite(capturedAt) ||
      attachmentHashes.length > MCP_CLIP_MAX_ATTACHMENTS || attachmentHashes.some((hash) => !/^[0-9a-f]{64}$/.test(hash))) {
    throw new Error("invalid_clip_payload");
  }
  const previous = await readSyncOperation(ctx.db, ctx.userId, input.operationId);
  if (previous) {
    if (previous.entity === "item" && previous.entityId === input.operationId && previous.result === "applied") {
      return { itemId: input.operationId, rev: previous.rev, result: "duplicate" };
    }
    throw new Error("operation_conflict");
  }
  if (!(await verifyMcpClipAttachments(ctx.db, ctx.tokenId, ctx.userId, attachmentHashes, SEALED_ATTACHMENT_MIME))) {
    throw new Error("attachment_missing_or_not_uploaded");
  }
  const markdown = buildClipMarkdown({ ...input, title, markdown: body });
  const bytes = new TextEncoder().encode(markdown);
  if (bytes.byteLength > 1_800_000) throw new Error("clip_too_large");
  const contentHash = hex(await crypto.subtle.digest("SHA-256", bytes));
  // Reusing operationId as item id makes retries deterministic without storing page content in an idempotency table.
  const item: Item = {
    id: input.operationId, userId: ctx.userId, type: "note", topicId: null, groupId: null,
    title, content: { scope: "plain", markdown }, tags: [...new Set(input.tags?.map((tag) => tag.trim()).filter(Boolean))],
    status: null, attachmentHashes,
    source: "clipper", rev: 1, metaRev: 1, contentHash, pinned: false, starred: false,
    createdAt: ctx.now, updatedAt: ctx.now, deletedAt: null,
  };
  return insertServerItem({ db: ctx.db, userId: ctx.userId, deviceId: `mcp:${ctx.tokenId}`, now: ctx.now }, item, input.operationId);
}
