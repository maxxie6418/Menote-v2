import type { Item, McpBookmarkRequest, McpBookmarkResult, McpTokenScope, OutboxOperation } from "@menote/shared";
import { readMcpBookmarkTarget } from "../db/mcpBookmarks";
import { readItemState, readSyncOperation } from "../db/sync";
import { applyOperation } from "./syncService";
import { appendBookmarkToNote, appendBookmarkToTable } from "./mcpBookmarkFormat";

export interface McpBookmarkContext {
  db: D1Database; userId: string; tokenId: string; scope: McpTokenScope; now: number;
}

function validWebUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; }
  catch { return false; }
}

function digestHex(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validate(input: McpBookmarkRequest): void {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (input.schemaVersion !== 1 || !uuid.test(input.operationId) || !input.targetItemId.trim() || input.targetItemId.length > 128 ||
      !input.title.trim() || input.title.length > 1000 || !validWebUrl(input.link) ||
      (input.excerpt?.length ?? 0) > 10_000 || (input.note?.length ?? 0) > 10_000 ||
      !Array.isArray(input.tags) || input.tags.length > 100 || input.tags.some((tag) => typeof tag !== "string" || tag.length > 200) ||
      !["link", "article", "image", "video", "document", "audio"].includes(input.type) ||
      (input.cover !== undefined && (!validWebUrl(input.cover) || input.cover.length > 4096)) ||
      !Number.isFinite(Date.parse(input.capturedAt)) || typeof input.important !== "boolean") {
    throw new Error("invalid_bookmark_payload");
  }
}

export async function appendMcpBookmark(ctx: McpBookmarkContext, input: McpBookmarkRequest): Promise<McpBookmarkResult> {
  validate(input);
  const prior = await readSyncOperation(ctx.db, ctx.userId, input.operationId);
  if (prior) {
    if (prior.entity !== "item" || prior.entityId !== input.targetItemId) throw new Error("bookmark_operation_rejected");
    if (prior.result === "applied" || prior.result === "duplicate") {
      return { targetItemId: input.targetItemId, rev: prior.rev, result: "duplicate" };
    }
    throw new Error(prior.result === "conflict" ? "bookmark_conflict" : "bookmark_operation_rejected");
  }

  const item = await readMcpBookmarkTarget(ctx.db, ctx.userId, input.targetItemId, ctx.scope);
  if (!item || item.content.scope !== "plain") throw new Error("bookmark_target_unavailable");
  const state = await readItemState(ctx.db, ctx.userId, item.id);
  if (!state || state.deletedAt !== null) throw new Error("bookmark_target_unavailable");
  const markdown = item.type === "table"
    ? appendBookmarkToTable(item.content.markdown, input)
    : appendBookmarkToNote(item.content.markdown, input);
  const contentHash = digestHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(markdown)));
  const updated: Item = {
    ...item, content: { scope: "plain", markdown }, rev: state.rev, metaRev: state.metaRev,
    contentHash, updatedAt: ctx.now,
  };
  const operation: OutboxOperation = {
    operationId: input.operationId, userId: ctx.userId, entityId: item.id, entity: "item", action: "upsert",
    baseRev: state.rev, baseMetaRev: state.metaRev, contentHash, payload: { item: updated },
  };
  const applied = await applyOperation({ db: ctx.db, userId: ctx.userId, deviceId: `mcp:${ctx.tokenId}`.slice(0, 64), now: ctx.now }, operation);
  if (applied.result === "conflict") {
    const raced = await readSyncOperation(ctx.db, ctx.userId, input.operationId);
    if (raced?.entity === "item" && raced.entityId === item.id && (raced.result === "applied" || raced.result === "duplicate")) {
      return { targetItemId: item.id, rev: raced.rev, result: "duplicate" };
    }
    throw new Error("bookmark_conflict");
  }
  if (applied.result !== "applied" && applied.result !== "duplicate") throw new Error("bookmark_write_failed");
  return { targetItemId: item.id, rev: applied.rev, result: applied.result };
}
