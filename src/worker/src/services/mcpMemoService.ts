import type { Item, McpMemoRequest, McpMemoResult, OutboxOperation } from "@menote/shared";
import { applyOperation } from "./syncService";

const MAX_TEXT_LENGTH = 20_000;
const MAX_SOURCE_TITLE_LENGTH = 500;

export interface McpMemoContext { db: D1Database; userId: string; tokenId: string; now: number }

function isWebUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; }
  catch { return false; }
}

function hex(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 选区文本转为逐行引用块；来源行统一放在引文之后，保持时间线里的可读出处。 */
export function buildMemoMarkdown(input: { text: string; sourceUrl?: string; sourceTitle?: string }): string {
  const quote = input.text.trim().split(/\r?\n/).map((line) => `> ${line.trimEnd()}`).join("\n");
  if (!input.sourceUrl) return quote;
  const host = new URL(input.sourceUrl).host;
  const label = (input.sourceTitle ?? "").trim().slice(0, MAX_SOURCE_TITLE_LENGTH) || host;
  return `${quote}\n\n—— [${label}](${input.sourceUrl})`;
}

export async function createMcpMemo(ctx: McpMemoContext, input: McpMemoRequest): Promise<McpMemoResult> {
  const text = input.text.trim();
  const sourceUrl = input.sourceUrl?.trim() ?? "";
  const sourceTitle = input.sourceTitle?.trim() ?? "";
  if (input.schemaVersion !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.operationId) ||
      !text || text.length > MAX_TEXT_LENGTH ||
      (sourceUrl && (!isWebUrl(sourceUrl) || sourceUrl.length > 4_096)) || sourceTitle.length > MAX_SOURCE_TITLE_LENGTH) {
    throw new Error("invalid_memo_payload");
  }
  const markdown = buildMemoMarkdown({ text, ...(sourceUrl ? { sourceUrl } : {}), ...(sourceTitle ? { sourceTitle } : {}) });
  const contentHash = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(markdown)));
  // 与剪藏一致：operationId 直接作 item id，重试天然幂等，无需额外去重表。
  const item: Item = {
    id: input.operationId, userId: ctx.userId, type: "memo", topicId: null, groupId: null,
    title: null, tags: [], status: null, attachmentHashes: [], source: "clipper", rev: 1, metaRev: 1,
    contentHash, pinned: false, starred: false, createdAt: ctx.now, updatedAt: ctx.now, deletedAt: null,
    content: { scope: "plain", markdown },
  };
  const operation: OutboxOperation = {
    operationId: input.operationId, userId: ctx.userId, entityId: item.id, entity: "item", action: "upsert",
    baseRev: 0, baseMetaRev: 0, contentHash, payload: { item },
  };
  const applied = await applyOperation({ db: ctx.db, userId: ctx.userId, deviceId: `mcp:${ctx.tokenId}`.slice(0, 64), now: ctx.now }, operation);
  if (applied.result !== "applied" && applied.result !== "duplicate") {
    throw new Error(applied.result === "conflict" ? "operation_conflict" : applied.result === "rejected" ? applied.code : "memo_failed");
  }
  return { itemId: item.id, rev: applied.rev, result: applied.result };
}
