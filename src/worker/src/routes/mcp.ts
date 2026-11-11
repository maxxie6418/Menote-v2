import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { McpBookmarkRequest, McpClipRequest, McpMemoRequest } from "@menote/shared";
import { Hono } from "hono";
import type { AppEnv } from "../middleware/session";
import { appendMcpAudit, incrementMcpRateLimit } from "../db/mcpAudit";
import { findVisibleAttachmentOwner } from "../db/mcpPermissions";
import { authenticateMcpToken } from "../services/mcpTokenManagementService";
import { createClipNote } from "../services/mcpClipService";
import { createMcpMemo } from "../services/mcpMemoService";
import { appendMcpBookmark } from "../services/mcpBookmarkService";
import { readUserAttachment, storeAttachment } from "../services/attachmentService";
import { ensureSchemaReady } from "../services/authService";
import { listClipTemplates, persistClipTemplate, registerCaptureAdapters } from "../services/clipTemplateService";

export const mcpRoutes = new Hono<AppEnv>();

const clipInput = z.object({
  schemaVersion: z.literal(1),
  operationId: z.string().uuid(),
  title: z.string().min(1).max(500),
  markdown: z.string().min(1).max(900_000),
  sourceUrl: z.string().url().max(4_096),
  capturedAt: z.string().datetime({ offset: true }),
  attachmentHashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(50).optional(),
  metadata: z.object({
    author: z.string().max(500).optional(), publishedAt: z.string().max(100).optional(),
    siteName: z.string().max(500).optional(), description: z.string().max(4_000).optional(),
    canonicalUrl: z.string().url().max(4_096).optional(),
  }).default({}),
});
const uploadInput = z.object({
  name: z.string().min(1).max(255), mime: z.string().min(1).max(255), base64: z.string().min(1).max(7_000_000),
});
const readInput = z.object({ sha256: z.string().regex(/^[0-9a-f]{64}$/) });
const bookmarkInput = z.object({
  schemaVersion: z.literal(1), operationId: z.string().uuid(), targetItemId: z.string().min(1).max(128),
  title: z.string().min(1).max(1000), link: z.string().url().max(4096), excerpt: z.string().max(10_000).optional(),
  note: z.string().max(10_000).optional(), tags: z.array(z.string().max(200)).max(100),
  type: z.enum(["link", "article", "image", "video", "document", "audio"]),
  cover: z.string().url().max(4096).optional(), capturedAt: z.string().datetime({ offset: true }), important: z.boolean(),
});
const memoInput = z.object({
  schemaVersion: z.literal(1), operationId: z.string().uuid(), text: z.string().min(1).max(20_000),
  sourceUrl: z.string().url().max(4_096).optional(), sourceTitle: z.string().max(500).optional(),
  tags: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
});

function decodeBase64(value: string): ArrayBuffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error("invalid_attachment");
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let offset = 0; offset < decoded.length; offset += 1) bytes[offset] = decoded.charCodeAt(offset);
  return bytes.buffer;
}

function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

function extensionOrigin(origin: string | null): string | null {
  if (!origin) return null;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "chrome-extension:" || parsed.protocol === "moz-extension:") && parsed.host ? origin : null;
  } catch { return null; }
}

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers({ "Vary": "Origin", "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id, Mcp-Method, Mcp-Name",
    "Access-Control-Expose-Headers": "Mcp-Protocol-Version, Mcp-Session-Id, WWW-Authenticate", "Access-Control-Max-Age": "600" });
  const allowed = extensionOrigin(origin);
  if (allowed) headers.set("Access-Control-Allow-Origin", allowed);
  return headers;
}

function withCors(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);
  corsHeaders(origin).forEach((value, key) => headers.set(key, value));
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function isToolCall(request: Request): Promise<boolean> {
  const headerMethod = request.headers.get("Mcp-Method");
  if (headerMethod) return headerMethod === "tools/call";
  const message: unknown = await request.clone().json().catch(() => null);
  const messages = Array.isArray(message) ? message : [message];
  return messages.some((entry) => Boolean(entry && typeof entry === "object" &&
    "method" in entry && entry.method === "tools/call"));
}

mcpRoutes.options("/api/mcp", (c) => new Response(null, { status: 204, headers: corsHeaders(c.req.header("Origin") ?? null) }));
mcpRoutes.on(["GET", "PUT", "DELETE"], "/api/mcp", (c) => c.json({ error: "method_not_allowed" }, 405, { Allow: "POST, OPTIONS" }));

mcpRoutes.post("/api/mcp", async (c) => {
  const origin = c.req.header("Origin") ?? null;
  if (origin && !extensionOrigin(origin)) return c.json({ error: "origin_not_allowed" }, 403);
  if (!(await ensureSchemaReady(c.env.DB))) return withCors(c.json({ error: "unavailable" }, 503), origin);
  const authorization = c.req.header("Authorization") ?? "";
  const match = /^Bearer\s+(mn_[A-Za-z0-9_-]{20,})$/i.exec(authorization);
  const pepper: unknown = Reflect.get(c.env, "AUTH_PEPPER");
  if (!match || typeof pepper !== "string" || !pepper.trim()) return withCors(c.json({ error: "unauthorized" }, 401), origin);
  const now = Date.now();
  const token = await authenticateMcpToken(c.env.DB, match[1]!, pepper, now);
  if (!token) return withCors(c.json({ error: "unauthorized" }, 401), origin);
  if (await isToolCall(c.req.raw)) {
    const count = await incrementMcpRateLimit(c.env.DB, token.id, now);
    if (count > token.ratePerMinute) return withCors(c.json({ error: "rate_limited" }, 429,
      { "Retry-After": String(60 - Math.floor((now % 60_000) / 1_000)) }), origin);
  }

  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "Menote", version: "1.0.0" });
    server.registerTool("connection_status", {
      description: "Confirm that the authenticated Menote MCP endpoint is available. Does not inspect project content.",
    }, async () => ({ content: [{ type: "text", text: "Menote MCP is available." }] }));
    if (token.permissions.includes("item:create")) {
      server.registerTool("clip_page", {
        description: "Create a clipped web page as a Note in the Menote inbox. Does not read existing project content.",
        inputSchema: clipInput,
      }, async (raw) => {
        const operationId = typeof raw.operationId === "string" ? raw.operationId : null;
        try {
          if (Array.isArray(raw.attachmentHashes) && raw.attachmentHashes.length > 0 && !token.permissions.includes("attachment:access")) {
            throw new Error("attachment_permission_required");
          }
          const result = await createClipNote({ db: c.env.DB, userId: token.userId, tokenId: token.id, now }, raw as McpClipRequest);
          await appendMcpAudit(c.env.DB, { id: crypto.randomUUID(), userId: token.userId, tokenId: token.id,
            tool: "clip_page", itemId: result.itemId, revBefore: null, revAfter: result.rev,
            result: result.result, operationId: result.itemId, at: now });
          return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
        } catch (error) {
          if (operationId) {
            await appendMcpAudit(c.env.DB, { id: crypto.randomUUID(), userId: token.userId, tokenId: token.id,
              tool: "clip_page", itemId: operationId, revBefore: null, revAfter: null,
              result: error instanceof Error ? error.message.slice(0, 100) : "clip_failed", operationId, at: now });
          }
          return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "clip_failed" }] };
        }
      });
    }
    if (token.permissions.includes("item:create") && token.includeMemos) {
      server.registerTool("create_memo", {
        description: "Create a Memo (short-form timeline entry) in Menote. Does not read existing project content.",
        inputSchema: memoInput,
      }, async (raw) => {
        const request = raw as McpMemoRequest;
        const operationId = typeof request.operationId === "string" ? request.operationId : null;
        try {
          const result = await createMcpMemo({ db: c.env.DB, userId: token.userId, tokenId: token.id, now }, request);
          await appendMcpAudit(c.env.DB, { id: crypto.randomUUID(), userId: token.userId, tokenId: token.id,
            tool: "create_memo", itemId: result.itemId, revBefore: null, revAfter: result.rev,
            result: result.result, operationId: request.operationId, at: now });
          return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
        } catch (error) {
          if (operationId) {
            await appendMcpAudit(c.env.DB, { id: crypto.randomUUID(), userId: token.userId, tokenId: token.id,
              tool: "create_memo", itemId: operationId, revBefore: null, revAfter: null,
              result: error instanceof Error ? error.message.slice(0, 100) : "memo_failed", operationId, at: now });
          }
          return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "memo_failed" }] };
        }
      });
    }
    if (token.permissions.includes("bookmark:write")) {
      server.registerTool("append_bookmark", {
        description: "Append a URL bookmark to one specified plain Note or Table. Does not return existing target content and does not require content read permission.",
        inputSchema: bookmarkInput,
      }, async (raw) => {
        const request = raw as McpBookmarkRequest;
        try {
          const result = await appendMcpBookmark({ db: c.env.DB, userId: token.userId, tokenId: token.id, scope: token.scope, now }, request);
          await appendMcpAudit(c.env.DB, { id: crypto.randomUUID(), userId: token.userId, tokenId: token.id,
            tool: "append_bookmark", itemId: result.targetItemId, revBefore: null, revAfter: result.rev,
            result: result.result, operationId: request.operationId, at: now });
          return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
        } catch (error) {
          const code = error instanceof Error ? error.message : "";
          const safeCode = ["invalid_bookmark_payload", "bookmark_target_unavailable", "bookmark_target_invalid",
            "bookmark_conflict", "bookmark_operation_rejected", "bookmark_write_failed"].includes(code)
            ? code : "bookmark_write_failed";
          await appendMcpAudit(c.env.DB, { id: crypto.randomUUID(), userId: token.userId, tokenId: token.id,
            tool: "append_bookmark", itemId: request.targetItemId, revBefore: null, revAfter: null,
            result: safeCode,
            operationId: request.operationId, at: now });
          return { isError: true, content: [{ type: "text", text: safeCode }] };
        }
      });
    }
    if (token.permissions.includes("clip:templates:read")) {
      server.registerTool("list_clip_templates", {
        description: "List this account's clipping rules (declarative templates and capture-adapter registrations), including disabled entries. This does not read Menote notes or page content.",
      }, async () => {
        const templates = await listClipTemplates(c.env.DB, token.userId, false);
        const versionMaterial = templates.map(({ template, version, updatedAt }) => ({ id: template.id, version, updatedAt }));
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(versionMaterial)));
        const revision = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
        const payload = { revision, templates };
        return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
      });
    }
    if (token.permissions.includes("clip:templates:write")) {
      server.registerTool("save_clip_template", {
        description: "Create or update a declarative clipping template owned by this Menote account.",
        inputSchema: z.object({ template: z.unknown() }),
      }, async ({ template }) => {
        const saved = await persistClipTemplate(c.env.DB, token.userId, template, now);
        if (!saved || saved === "version_conflict") return { isError: true, content: [{ type: "text", text: "invalid_template" }] };
        await appendMcpAudit(c.env.DB, { id: crypto.randomUUID(), userId: token.userId, tokenId: token.id,
          tool: "save_clip_template", itemId: null, resourceId: saved.id, revBefore: null, revAfter: null,
          result: "saved", operationId: null, at: now });
        return { content: [{ type: "text", text: JSON.stringify({ id: saved.id, updatedAt: now }) }],
          structuredContent: { id: saved.id, updatedAt: now } };
      });
      server.registerTool("register_capture_adapters", {
        description: "Register built-in capture-adapter metadata (id, version, matched hosts) so the web template manager can list and toggle imperative clipping rules. Idempotent; prunes stale adapter entries.",
        inputSchema: z.object({
          adapters: z.array(z.object({
            id: z.string().regex(/^[A-Za-z0-9:_-]{1,80}$/),
            name: z.string().min(1).max(120),
            version: z.string().min(1).max(24),
            hosts: z.array(z.string().min(1).max(253)).min(1).max(16),
            upstream: z.string().max(120).optional(),
          })).min(1).max(16),
        }),
      }, async ({ adapters }) => {
        const outcome = await registerCaptureAdapters(c.env.DB, token.userId, adapters, now);
        await appendMcpAudit(c.env.DB, { id: crypto.randomUUID(), userId: token.userId, tokenId: token.id,
          tool: "register_capture_adapters", itemId: null, resourceId: null, revBefore: null, revAfter: null,
          result: "registered", operationId: null, at: now });
        return { content: [{ type: "text", text: JSON.stringify(outcome) }], structuredContent: outcome };
      });
    }
    if (token.permissions.includes("item:create") && token.permissions.includes("attachment:access")) {
      server.registerTool("upload_attachment", {
        description: "Upload an attachment for a new plain-text item. Requires item creation and attachment permissions.",
        inputSchema: uploadInput,
      }, async ({ name, mime, base64 }) => {
        try {
          if (!/^[\w.+-]+\/[\w.+-]+(?:\s*;[^\r\n]*)?$/.test(mime)) throw new Error("invalid_attachment");
          const attachment = await storeAttachment({ db: c.env.DB, bucket: c.env.BUCKET }, token.userId, decodeBase64(base64), mime, name);
          await appendMcpAudit(c.env.DB, { id: crypto.randomUUID(), userId: token.userId, tokenId: token.id,
            tool: "upload_attachment", itemId: null, resourceId: attachment.sha256, revBefore: null, revAfter: null,
            result: "uploaded", operationId: null, at: now });
          const result = { ...attachment, name };
          return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
        } catch (error) {
          await appendMcpAudit(c.env.DB, { id: crypto.randomUUID(), userId: token.userId, tokenId: token.id,
            tool: "upload_attachment", itemId: null, resourceId: null, revBefore: null, revAfter: null,
            result: error instanceof Error ? error.message.slice(0, 100) : "attachment_upload_failed", operationId: null, at: now });
          return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "attachment_upload_failed" }] };
        }
      });
    }
    if (token.permissions.includes("content:read") && token.permissions.includes("attachment:access")) {
      server.registerTool("read_attachment", {
        description: "Read an attachment only when at least one referencing plain-text item is within this token's visible scope.",
        inputSchema: readInput,
      }, async ({ sha256 }) => {
        const itemId = await findVisibleAttachmentOwner(c.env.DB, token.userId, sha256, token.includeMemos, token.scope);
        if (!itemId) {
          await appendMcpAudit(c.env.DB, { id: crypto.randomUUID(), userId: token.userId, tokenId: token.id,
            tool: "read_attachment", itemId: null, resourceId: sha256, revBefore: null, revAfter: null,
            result: "denied_or_missing", operationId: null, at: now });
          return { isError: true, content: [{ type: "text", text: "attachment_not_available" }] };
        }
        const attachment = await readUserAttachment({ db: c.env.DB, bucket: c.env.BUCKET }, token.userId, sha256);
        if (!attachment) {
          await appendMcpAudit(c.env.DB, { id: crypto.randomUUID(), userId: token.userId, tokenId: token.id,
            tool: "read_attachment", itemId, resourceId: sha256, revBefore: null, revAfter: null,
            result: "missing_object", operationId: null, at: now });
          return { isError: true, content: [{ type: "text", text: "attachment_not_available" }] };
        }
        const base64 = encodeBase64(await attachment.object.arrayBuffer());
        await appendMcpAudit(c.env.DB, { id: crypto.randomUUID(), userId: token.userId, tokenId: token.id,
          tool: "read_attachment", itemId, resourceId: sha256, revBefore: null, revAfter: null,
          result: "read", operationId: null, at: now });
        const result = { sha256, mime: attachment.mime, base64 };
        return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
      });
    }
    return server;
  }, { responseMode: "json" });
  const response = await handler.fetch(c.req.raw);
  return withCors(response, origin);
});
