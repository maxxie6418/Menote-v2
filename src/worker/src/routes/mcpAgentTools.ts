import type { McpServer } from "@modelcontextprotocol/server";
import type { McpToken } from "@menote/shared";
import * as z from "zod/v4";
import { createAuditedAgentItem, getAgentFolders, getAgentItem, getAgentVersion, getAgentVersions, queryAgentItems } from "../services/mcpAgentService";

const cursor = z.string().min(1).max(128).optional();
const page = { cursor, limit: z.number().int().min(1).max(50).default(25) };
const type = z.enum(["note", "table", "memo"]);
const status = z.enum(["todo", "doing", "done"]);
const id = z.string().trim().min(1).max(2048);
const filters = {
  ...page, type: type.optional(), folder_id: z.string().max(128).nullable().optional(),
  tag: z.string().trim().min(1).max(200).optional(), task_status: status.optional(),
  updated_after: z.number().int().nonnegative().optional(),
};

function ok(result: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result };
}

function fail(code: string) {
  return { isError: true, content: [{ type: "text" as const, text: code }] };
}

export function registerAgentTools(server: McpServer, db: D1Database, token: McpToken, now: number): void {
  if (token.permissions.includes("content:read")) {
    server.registerTool("search", {
      description: "Find authorized items by literal keyword in title or Markdown. Use read_item with a returned ID to read the content.",
      inputSchema: z.object({ ...filters, query: z.string().trim().min(1).max(200) }).strict(),
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async (input) => ok(await queryAgentItems(db, token, input)));
    server.registerTool("list_items", {
      description: "List authorized item metadata using type, topic/group ID, tag, task status or updated time. Returns no Markdown.",
      inputSchema: z.object(filters).strict(),
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async (input) => ok(await queryAgentItems(db, token, input)));
    server.registerTool("list_folders", {
      description: "List authorized Menote topics and groups with parent IDs and visible plain item counts.",
      inputSchema: z.object(page).strict(),
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async ({ cursor, limit }) => ok(await getAgentFolders(db, token, cursor, limit)));
    server.registerTool("read_item", {
      description: "Read authorized Markdown in chunks. Supply version_id to read a server-side snapshot. Pass next_cursor with the same IDs to continue. Encrypted notes expose only their titles.",
      inputSchema: z.object({ id, cursor: z.string().regex(/^\d{1,16}:\d{1,8}$/).optional(),
        version_id: z.string().trim().min(1).max(128).optional(),
        max_chars: z.number().int().min(1).max(20_000).default(8_000) }).strict(),
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async (input) => {
      const result = input.version_id
        ? await getAgentVersion(db, token, input.id, input.version_id, input.cursor, input.max_chars)
        : await getAgentItem(db, token, input.id, input.cursor, input.max_chars);
      return result.value ? ok(result.value) : fail(result.error);
    });
    server.registerTool("list_versions", {
      description: "List server-side plain snapshot metadata for an authorized item. History that exists only in a browser is unavailable here.",
      inputSchema: z.object({ id, ...page }).strict(),
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async (input) => {
      const result = await getAgentVersions(db, token, input.id, input.cursor, input.limit);
      return result ? ok(result) : fail("item_unavailable");
    });
  }
  if (token.permissions.includes("item:create")) {
    server.registerTool("create_item", {
      description: "Create a plain Note or Markdown Table in the inbox, or a Memo on the timeline if the token includes Memos. Supply a fresh UUID operation_id and reuse it on retry.",
      inputSchema: z.object({
        operation_id: z.uuid(), type, title: z.string().trim().min(1).max(500).optional(),
        content: z.string().min(1).max(450_000),
        tags: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
        task: z.object({ status: status.optional() }).strict().optional(),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async (input) => {
      const result = await createAuditedAgentItem(db, token, input, now);
      return result.value ? ok(result.value) : fail(result.error);
    });
  }
}
