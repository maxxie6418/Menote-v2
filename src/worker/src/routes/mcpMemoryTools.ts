import type { McpServer } from "@modelcontextprotocol/server";
import { MEMORY_KEY_PATTERN, MEMORY_LIMITS, MEMORY_PROJECT_PATTERN, MEMORY_SCOPES, MEMORY_STATUSES, type McpToken } from "@menote/shared";
import * as z from "zod/v4";
import { MemoryError, mutateMemory, queryMemory } from "../services/memoryService";

const project_id = z.string().max(MEMORY_LIMITS.project).regex(MEMORY_PROJECT_PATTERN).optional();
const key = z.string().max(MEMORY_LIMITS.key).regex(MEMORY_KEY_PATTERN);
const text = {
  title: z.string().trim().min(1).max(MEMORY_LIMITS.title),
  value: z.string().trim().min(1).max(MEMORY_LIMITS.value),
  source: z.string().trim().min(1).max(MEMORY_LIMITS.source),
};
const writeIds = { binding_id: z.uuid(), operation_id: z.uuid() };

async function toolResult<T extends object>(run: () => Promise<T>) {
  try {
    const result = await run();
    return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: { ...result } };
  } catch (error) {
    if (!(error instanceof MemoryError)) throw error;
    return { isError: true, content: [{ type: "text" as const, text: error.code }] };
  }
}

export function registerMemoryTools(server: McpServer, db: SqlDatabase, token: McpToken, now: number) {
  if (!token.permissions.includes("memory:read")) return;
  server.registerTool("memory_query", {
    description: "Read personal or project records from this account's bound Menote memory table. Retain binding_id for subsequent calls.",
    inputSchema: z.object({ binding_id: z.uuid().optional(), scope: z.enum(MEMORY_SCOPES), project_id, key: key.optional(),
      query: z.string().trim().min(1).max(200).optional(), status: z.enum([...MEMORY_STATUSES, "all"]).optional(),
      limit: z.number().int().min(1).max(MEMORY_LIMITS.page).optional(), cursor: z.string().min(1).max(200).optional() }).strict(),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, (input) => toolResult(() => queryMemory(db, token, input, now)));
  if (!token.permissions.includes("memory:write")) return;
  server.registerTool("memory_create", {
    description: "Create a memory after checking for the key in the same scope and project, including archived records. Reuse operation_id only for an identical retry.",
    inputSchema: z.object({ ...writeIds, scope: z.enum(MEMORY_SCOPES), project_id, key, ...text }).strict(),
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, (input) => toolResult(() => mutateMemory(db, token, input, now)));
  server.registerTool("memory_update", {
    description: "Update, archive or restore a memory row using the current binding and row revision. Provide source together with a corrected value.",
    inputSchema: z.object({ ...writeIds, id: z.string().regex(/^[a-z0-9_-]{1,128}$/i), expected_row_rev: z.number().int().positive(),
      patch: z.object({ ...text, status: z.enum(MEMORY_STATUSES) }).partial().strict().refine((patch) => Object.keys(patch).length > 0) }).strict(),
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, (input) => toolResult(() => mutateMemory(db, token, input, now)));
}
