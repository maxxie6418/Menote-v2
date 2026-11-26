import type { Item, McpToken, McpTokenScope, MemoryStatus } from "@menote/shared";
import { MCP_ITEM_FROM, mcpItemAccess } from "./mcpPermissions";
import { mcpAuditStatement } from "./mcpAudit";
import { appendSyncLogStatement, commitWrites, insertItemRowStatement, rowToItem, updateItemContentStatement } from "./sync";

const OWNER_SCOPE: McpTokenScope = { mode: "all", topicIds: [], groupIds: [] };
const MEMORY_STATE_CHANGED = "tp20_memory_state_changed";

export interface MemoryBindingState {
  enabled: boolean;
  bindingId: string | null;
  tableId: string | null;
}

export async function readMemoryBinding(db: SqlDatabase, userId: string): Promise<MemoryBindingState> {
  const row = await db.prepare("SELECT enabled, binding_id, table_item_id FROM memory_bindings WHERE user_id = ?")
    .bind(userId).first<{ enabled: number; binding_id: string | null; table_item_id: string | null }>();
  return { enabled: row?.enabled === 1, bindingId: row?.binding_id ?? null, tableId: row?.table_item_id ?? null };
}

export async function setMemoryEnabled(db: SqlDatabase, userId: string, enabled: boolean, replacementId: string): Promise<void> {
  await db.prepare(`INSERT INTO memory_bindings (user_id, enabled) VALUES (?, ?)
    ON CONFLICT (user_id) DO UPDATE SET enabled = excluded.enabled,
      binding_id = CASE WHEN binding_id IS NOT NULL AND memory_bindings.enabled != excluded.enabled THEN ? ELSE binding_id END`)
    .bind(userId, Number(enabled), replacementId).run();
}

export async function unsetMemoryBinding(db: SqlDatabase, userId: string, bindingId: string): Promise<boolean> {
  const result = await db.prepare("UPDATE memory_bindings SET binding_id = NULL, table_item_id = NULL WHERE user_id = ? AND binding_id = ?")
    .bind(userId, bindingId).run();
  return result.meta.changes === 1;
}

function tableSelection(userId: string, tableId: string, scope: McpTokenScope) {
  const { clauses, bindings } = mcpItemAccess({ userId, scope, includeMemos: false }, true);
  return { predicate: `${clauses.join(" AND ")} AND i.type = 'table' AND i.id = ?`, args: [...bindings, tableId] };
}

export async function readMemoryTable(db: SqlDatabase, userId: string, tableId: string, scope = OWNER_SCOPE) {
  const selection = tableSelection(userId, tableId, scope);
  const row = await db.prepare(`SELECT i.*, topic.name AS memory_topic_name ${MCP_ITEM_FROM} WHERE ${selection.predicate}`)
    .bind(...selection.args).first<Record<string, unknown>>();
  return row ? { item: rowToItem(row), topicName: typeof row.memory_topic_name === "string" ? row.memory_topic_name : null } : null;
}

export async function isRaindropTable(db: SqlDatabase, userId: string, tableId: string): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM raindrop_bindings WHERE user_id = ? AND table_item_id = ?").bind(userId, tableId).first()) !== null;
}

function guardMemoryState(db: SqlDatabase, userId: string, bindingId: string | null, tableId: string | null): SqlStatement {
  return db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM memory_bindings WHERE user_id = ? AND enabled = 1
    AND binding_id IS ? AND table_item_id IS ?) THEN 1 ELSE json_extract('[]', ?) END`)
    .bind(userId, bindingId, tableId, MEMORY_STATE_CHANGED);
}

export function guardMemoryOwnerBinding(db: SqlDatabase, userId: string, bindingId: string, tableId: string): SqlStatement {
  return db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM memory_bindings WHERE user_id = ? AND binding_id = ? AND table_item_id = ?)
    THEN 1 ELSE json_extract('[]', ?) END`).bind(userId, bindingId, tableId, MEMORY_STATE_CHANGED);
}

function guardMemoryTable(db: SqlDatabase, item: Item, scope: McpTokenScope): SqlStatement {
  const selection = tableSelection(item.userId, item.id, scope);
  return db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 ${MCP_ITEM_FROM} WHERE ${selection.predicate}
    AND i.rev = ? AND i.meta_rev = ? AND i.content_hash = ?
    AND NOT EXISTS (SELECT 1 FROM raindrop_bindings r WHERE r.user_id = i.user_id AND r.table_item_id = i.id))
    THEN 1 ELSE json_extract('[]', ?) END`).bind(...selection.args, item.rev, item.metaRev, item.contentHash, MEMORY_STATE_CHANGED);
}

function bindTableStatement(db: SqlDatabase, userId: string, tableId: string, bindingId: string): SqlStatement {
  return db.prepare("UPDATE memory_bindings SET binding_id = ?, table_item_id = ? WHERE user_id = ?")
    .bind(bindingId, tableId, userId);
}

export function isMemoryStateChanged(error: unknown): boolean {
  return error instanceof Error && error.message.includes(MEMORY_STATE_CHANGED);
}

export async function bindMemoryTable(db: SqlDatabase, previous: MemoryBindingState, current: Item, next: Item, bindingId: string) {
  await commitWrites(db, [
    guardMemoryState(db, current.userId, previous.bindingId, previous.tableId),
    guardMemoryTable(db, current, OWNER_SCOPE),
    updateItemContentStatement(db, current.userId, "memory:owner", next, next.rev),
    bindTableStatement(db, current.userId, current.id, bindingId),
    appendSyncLogStatement(db, current.userId, "item", current.id, "upsert", next.rev, current.metaRev, next.updatedAt),
  ]);
}

export async function createMemoryTable(db: SqlDatabase, previous: MemoryBindingState, item: Item, bindingId: string) {
  await commitWrites(db, [
    guardMemoryState(db, item.userId, previous.bindingId, previous.tableId),
    insertItemRowStatement(db, item.userId, "memory:owner", item),
    bindTableStatement(db, item.userId, item.id, bindingId),
    appendSyncLogStatement(db, item.userId, "item", item.id, "upsert", item.rev, item.metaRev, item.updatedAt),
  ]);
}

interface MemoryOperationKey { userId: string; bindingId: string; tokenId: string; operationId: string }
export interface MemoryOperationReceipt { inputHash: string; rowId: string; revBefore: number | null; revAfter: number; status: MemoryStatus }

export function readMemoryReceipt(db: SqlDatabase, key: MemoryOperationKey) {
  return db.prepare(`SELECT input_hash AS inputHash, row_id AS rowId, rev_before AS revBefore, rev_after AS revAfter, status
    FROM memory_operations WHERE user_id = ? AND binding_id = ? AND token_id = ? AND operation_id = ?`)
    .bind(key.userId, key.bindingId, key.tokenId, key.operationId).first<MemoryOperationReceipt>();
}

function guardMemoryToken(db: SqlDatabase, token: McpToken, now: number, write: boolean): SqlStatement {
  return db.prepare(`SELECT CASE WHEN EXISTS (SELECT 1 FROM mcp_tokens t WHERE id = ? AND user_id = ?
    AND token_hash = ? AND scope_json = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
    AND EXISTS (SELECT 1 FROM json_each(t.permissions_json) WHERE value = 'memory:read')
    AND (? = 0 OR EXISTS (SELECT 1 FROM json_each(t.permissions_json) WHERE value = 'memory:write')))
    THEN 1 ELSE json_extract('[]', ?) END`)
    .bind(token.id, token.userId, token.tokenHash, JSON.stringify(token.scope), now, Number(write), MEMORY_STATE_CHANGED);
}

export async function confirmMemoryRead(db: SqlDatabase, item: Item, bindingId: string, token: McpToken, now: number, write = false) {
  await commitWrites(db, [guardMemoryState(db, item.userId, bindingId, item.id), guardMemoryTable(db, item, token.scope),
    guardMemoryToken(db, token, now, write)]);
}

export async function writeMemoryOperation(
  db: SqlDatabase, current: Item, next: Item, token: McpToken, key: MemoryOperationKey,
  receipt: MemoryOperationReceipt, now: number,
) {
  const statements = [guardMemoryState(db, key.userId, key.bindingId, current.id), guardMemoryTable(db, current, token.scope),
    guardMemoryToken(db, token, now, true)];
  if (next !== current) {
    statements.push(updateItemContentStatement(db, key.userId, `mcp:${token.id}`, next, next.rev),
      appendSyncLogStatement(db, key.userId, "item", current.id, "upsert", next.rev, current.metaRev, now));
  }
  statements.push(db.prepare(`INSERT INTO memory_operations (user_id, binding_id, token_id, operation_id, input_hash,
    row_id, rev_before, rev_after, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(key.userId, key.bindingId, key.tokenId, key.operationId, receipt.inputHash, receipt.rowId,
      receipt.revBefore, receipt.revAfter, receipt.status, now));
  statements.push(mcpAuditStatement(db, { id: crypto.randomUUID(), userId: key.userId, tokenId: key.tokenId,
    tool: receipt.revBefore === null ? "memory_create" : "memory_update", itemId: current.id, resourceId: `${key.bindingId}:${receipt.rowId}`,
    revBefore: receipt.revBefore, revAfter: receipt.revAfter, result: next === current ? "duplicate" : "applied", operationId: key.operationId, at: now }));
  await commitWrites(db, statements);
}
