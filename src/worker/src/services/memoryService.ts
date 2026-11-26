import type { Item, McpToken, MemoryBindPreview, MemoryCreate, MemoryPluginStatus, MemoryQuery, MemoryQueryResult, MemoryRow, MemoryUpdate, MemoryWriteResult } from "@menote/shared";
import {
  bindMemoryTable, confirmMemoryRead, createMemoryTable, isMemoryStateChanged, isRaindropTable, readMemoryBinding, readMemoryReceipt,
  readMemoryTable, setMemoryEnabled, unsetMemoryBinding, writeMemoryOperation, type MemoryOperationReceipt,
} from "../db/memory";
import { MemoryTableError, memoryIdentity, memoryText, prepareMemoryBinding, readMemoryDocument, updateMemoryDocument, validMemoryIdentity } from "./memoryTable";
import { appendMcpAudit } from "../db/mcpAudit";

export class MemoryError extends Error {
  constructor(readonly code: string) { super(code); }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function newContent(item: Item, markdown: string, now: number): Promise<Item> {
  return { ...item, content: { scope: "plain", markdown }, contentHash: await sha256(markdown), rev: item.rev + 1, updatedAt: now };
}

export async function memoryPluginStatus(db: SqlDatabase, userId: string): Promise<MemoryPluginStatus> {
  const binding = await readMemoryBinding(db, userId);
  if (!binding.bindingId || !binding.tableId) return { enabled: binding.enabled, binding: null };
  const target = await readMemoryTable(db, userId, binding.tableId);
  let problem: string | undefined;
  if (!target || target.item.content.scope !== "plain") problem = "memory_unavailable";
  else {
    try { readMemoryDocument(target.item.content.markdown); }
    catch (error) { if (!(error instanceof MemoryTableError)) throw error; problem = error.code; }
  }
  return { enabled: binding.enabled, binding: { id: binding.bindingId, tableId: binding.tableId, title: target?.item.title ?? "已绑定表格",
    topicName: target?.topicName ?? null, available: !problem, problem } };
}

export async function enableMemoryPlugin(db: SqlDatabase, userId: string, enabled: boolean) {
  await setMemoryEnabled(db, userId, enabled, crypto.randomUUID());
  return memoryPluginStatus(db, userId);
}

async function ownerTable(db: SqlDatabase, userId: string, tableId: string) {
  if (await isRaindropTable(db, userId, tableId)) throw new MemoryError("table_already_bound");
  const target = await readMemoryTable(db, userId, tableId);
  if (!target || target.item.content.scope !== "plain") throw new MemoryError("table_unavailable");
  return { item: target.item, markdown: target.item.content.markdown };
}

export async function previewMemoryBinding(db: SqlDatabase, userId: string, tableId: string, now: number): Promise<MemoryBindPreview> {
  const { item, markdown } = await ownerTable(db, userId, tableId);
  try {
    const { columnsToAdd, rowCount, issues } = prepareMemoryBinding(markdown, now);
    return { tableId, rev: item.rev, columnsToAdd, rowCount, issues };
  } catch (error) {
    if (!(error instanceof MemoryTableError)) throw error;
    return { tableId, rev: item.rev, columnsToAdd: [], rowCount: 0, issues: [{ row: null, code: error.code }] };
  }
}

export async function connectMemoryTable(db: SqlDatabase, userId: string, tableId: string, rev: number, now: number) {
  const previous = await readMemoryBinding(db, userId);
  if (!previous.enabled) throw new MemoryError("memory_unavailable");
  const { item, markdown } = await ownerTable(db, userId, tableId);
  if (item.rev !== rev) throw new MemoryError("preview_stale");
  const prepared = prepareMemoryBinding(markdown, now);
  if (prepared.issues.length) throw new MemoryError("invalid_rows");
  try { await bindMemoryTable(db, previous, item, await newContent(item, prepared.markdown, now), crypto.randomUUID()); }
  catch (error) { if (!isMemoryStateChanged(error)) throw error; throw new MemoryError("preview_stale"); }
  return memoryPluginStatus(db, userId);
}

export async function createAndConnectMemoryTable(db: SqlDatabase, userId: string, now: number) {
  const previous = await readMemoryBinding(db, userId);
  if (!previous.enabled || previous.bindingId) throw new MemoryError("binding_changed");
  const { markdown } = prepareMemoryBinding("", now);
  const item: Item = { id: crypto.randomUUID(), userId, type: "table", title: "AI 记忆库", topicId: null, groupId: null,
    tags: [], status: null, attachmentHashes: [], source: "manual", rev: 1, metaRev: 1, contentHash: await sha256(markdown),
    pinned: false, starred: false, createdAt: now, updatedAt: now, deletedAt: null, content: { scope: "plain", markdown } };
  try { await createMemoryTable(db, previous, item, crypto.randomUUID()); }
  catch (error) { if (!isMemoryStateChanged(error)) throw error; throw new MemoryError("binding_changed"); }
  return memoryPluginStatus(db, userId);
}

export async function disconnectMemoryTable(db: SqlDatabase, userId: string, bindingId: string) {
  if (!await unsetMemoryBinding(db, userId, bindingId)) throw new MemoryError("binding_changed");
  return memoryPluginStatus(db, userId);
}

async function authorizedMemoryTable(db: SqlDatabase, token: McpToken, requestedId: string | undefined) {
  const binding = await readMemoryBinding(db, token.userId);
  if (!binding.enabled || !binding.bindingId || !binding.tableId) throw new MemoryError("memory_unavailable");
  if (requestedId !== undefined && requestedId !== binding.bindingId) throw new MemoryError("binding_changed");
  const target = await readMemoryTable(db, token.userId, binding.tableId, token.scope);
  if (!target || target.item.content.scope !== "plain") throw new MemoryError("memory_unavailable");
  try {
    return { bindingId: binding.bindingId, item: target.item, document: readMemoryDocument(target.item.content.markdown) };
  } catch (error) { if (!(error instanceof MemoryTableError)) throw error; throw new MemoryError("memory_unavailable"); }
}

export async function queryMemory(db: SqlDatabase, token: McpToken, input: MemoryQuery, now: number): Promise<MemoryQueryResult> {
  if (!token.permissions.includes("memory:read")) throw new MemoryError("memory_unavailable");
  if (!validMemoryIdentity(input.scope, input.project_id, input.key) || (input.cursor && !input.binding_id)) throw new MemoryError("invalid_input");
  const { bindingId, item, document } = await authorizedMemoryTable(db, token, input.binding_id);
  const status = input.status ?? "active";
  const keyword = input.query?.trim().toLowerCase() ?? "";
  const fingerprint = await sha256(JSON.stringify([token.id, bindingId, item.rev, input.scope, input.project_id ?? "", input.key ?? "", keyword, status]));
  let after = "";
  if (input.cursor) {
    const [hash, row, extra] = input.cursor.split(":");
    if (hash !== fingerprint || !row || extra !== undefined || !document.rows.some(({ id }) => id === row)) throw new MemoryError("cursor_stale");
    after = row;
  }
  const rows = document.rows.filter((row) => row.id > after && row.scope === input.scope && row.project_id === (input.project_id ?? "") &&
    (!input.key || row.key === input.key) && (status === "all" || row.status === status) &&
    (!keyword || [row.key, row.title, row.value].some((text) => text.toLowerCase().includes(keyword))))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const limit = input.limit ?? 20;
  try { await confirmMemoryRead(db, item, bindingId, token, now); }
  catch (error) { if (!isMemoryStateChanged(error)) throw error; throw new MemoryError(input.cursor ? "cursor_stale" : "memory_unavailable"); }
  return { binding_id: bindingId, rows: rows.slice(0, limit), next_cursor: rows.length > limit ? `${fingerprint}:${rows[limit - 1]!.id}` : null };
}

function receiptResult(receipt: MemoryOperationReceipt, inputHash: string): MemoryWriteResult {
  if (receipt.inputHash !== inputHash) throw new MemoryError("operation_conflict");
  return { id: receipt.rowId, row_rev: receipt.revAfter, status: receipt.status };
}

export async function mutateMemory(db: SqlDatabase, token: McpToken, input: MemoryCreate | MemoryUpdate, now: number): Promise<MemoryWriteResult> {
  try { return await mutateMemoryOnce(db, token, input, now); }
  catch (error) {
    if (error instanceof MemoryError) {
      const rowId = "id" in input ? input.id : null;
      await appendMcpAudit(db, { id: crypto.randomUUID(), userId: token.userId, tokenId: token.id,
        tool: rowId ? "memory_update" : "memory_create", itemId: null, resourceId: rowId ? `${input.binding_id}:${rowId}` : input.binding_id,
        revBefore: "expected_row_rev" in input ? input.expected_row_rev : null, revAfter: null,
        result: error.code, operationId: input.operation_id, at: now }).catch(() => undefined);
    }
    throw error;
  }
}

async function mutateMemoryOnce(db: SqlDatabase, token: McpToken, input: MemoryCreate | MemoryUpdate, now: number): Promise<MemoryWriteResult> {
  if (!token.permissions.includes("memory:read") || !token.permissions.includes("memory:write")) throw new MemoryError("memory_unavailable");
  const key = { userId: token.userId, bindingId: input.binding_id, tokenId: token.id, operationId: input.operation_id };
  const inputHash = await sha256(JSON.stringify(input, [...new Set([...Object.keys(input), ...("patch" in input ? Object.keys(input.patch) : [])])].sort()));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { item, document } = await authorizedMemoryTable(db, token, input.binding_id);
    const timestamp = new Date(now).toISOString();
    const updater = memoryText(token.name) || "Agent";
    try {
      const existing = await readMemoryReceipt(db, key);
      if (existing) {
        await confirmMemoryRead(db, item, key.bindingId, token, now, true);
        return receiptResult(existing, inputHash);
      }
      let row: MemoryRow;
      let previous: MemoryRow | undefined;
      if ("patch" in input) {
        previous = document.rows.find(({ id }) => id === input.id);
        if (!previous) throw new MemoryError("not_found");
        if (previous.row_rev !== input.expected_row_rev) throw new MemoryError("revision_conflict");
        const patch = { ...input.patch };
        for (const field of ["title", "value", "source"] as const) if (patch[field] !== undefined) patch[field] = memoryText(patch[field]!);
        if (patch.value !== undefined && patch.value !== previous.value && !patch.source) throw new MemoryError("source_required");
        const changed = (Object.keys(patch) as (keyof typeof patch)[]).some((field) => patch[field] !== previous![field]);
        row = changed ? { ...previous, ...patch, row_rev: previous.row_rev + 1, updated_at: timestamp, updated_by: updater } : previous;
      } else {
        if (!validMemoryIdentity(input.scope, input.project_id, input.key)) throw new MemoryError("invalid_input");
        const { scope, key: name } = input;
        const business = { scope, key: name, project_id: input.project_id ?? "" };
        if (document.rows.some((prior) => memoryIdentity(prior) === memoryIdentity(business))) throw new MemoryError("key_exists");
        row = { ...business, id: crypto.randomUUID(), row_rev: 1, status: "active", title: memoryText(input.title), value: memoryText(input.value),
          source: memoryText(input.source), updated_at: timestamp, updated_by: updater };
      }
      if (!row.title || !row.value || !row.source) throw new MemoryError("invalid_input");
      const next = row === previous ? item : await newContent(item, updateMemoryDocument(document, row), now);
      const receipt = { inputHash, rowId: row.id, revBefore: previous?.row_rev ?? null, revAfter: row.row_rev, status: row.status };
      await writeMemoryOperation(db, item, next, token, key, receipt, now);
      return receiptResult(receipt, inputHash);
    } catch (error) {
      if (error instanceof MemoryError) throw error;
      if (!isMemoryStateChanged(error) && !(await readMemoryReceipt(db, key))) throw error;
    }
  }
  throw new MemoryError("memory_unavailable");
}
