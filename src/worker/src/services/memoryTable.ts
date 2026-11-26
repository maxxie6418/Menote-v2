import { Document, isMap, parseDocument, type YAMLMap } from "yaml";
import {
  MEMORY_FIELDS, MEMORY_KEY_PATTERN, MEMORY_LIMITS, MEMORY_PROJECT_PATTERN, MEMORY_SCHEMA_KEY, MEMORY_SYSTEM_COLUMNS,
  type MemoryBindPreview, type MemoryRow, type MemoryScope, type MemoryStatus,
} from "@menote/shared";
import { findTable, renderTable, splitFrontmatter, type ParsedTable } from "./tableMarkdown";

type FieldKey = keyof typeof MEMORY_FIELDS;
type Cells = Map<string, string>;
type Issue = MemoryBindPreview["issues"][number];
const requiredColumns = Object.values(MEMORY_FIELDS).map(({ name }) => name);
const editableFields = ["title", "value", "source", "status"] as const;
const immutableFields = ["scope", "project_id", "key"] as const;

interface TableSource {
  yaml: string | null;
  body: string;
  parsed: ParsedTable | null;
  headers: string[];
  cells: Cells[];
}

export class MemoryTableError extends Error {
  constructor(readonly code: string, readonly issues: Issue[] = []) { super(code); }
}

export function memoryText(text: string): string { return text.replace(/[\r\n]+/g, " ").trim(); }

export function validMemoryIdentity(scope: MemoryScope, projectId: string | undefined, key?: string): boolean {
  const projectValid = scope === "personal" ? !projectId : Boolean(projectId && projectId.length <= MEMORY_LIMITS.project && MEMORY_PROJECT_PATTERN.test(projectId));
  return projectValid && (key === undefined || (key.length <= MEMORY_LIMITS.key && MEMORY_KEY_PATTERN.test(key)));
}

export function memoryIdentity(row: Pick<MemoryRow, "scope" | "project_id" | "key">) {
  return `${row.scope}/${row.project_id}/${row.key}`;
}

function openTable(markdown: string): TableSource {
  const { yaml, body } = splitFrontmatter(markdown);
  const parsed = findTable(body);
  const headers = parsed?.headers ?? [];
  if (new Set(headers).size !== headers.length || headers.some((name) => !name) ||
    parsed?.rows.some((cells) => cells.length > headers.length)) throw new MemoryTableError("invalid_table");
  return { yaml, body, parsed, headers, cells: (parsed?.rows ?? []).map((row) => new Map(headers.map((header, index) => [header, row[index] ?? ""]))) };
}

function cell(cells: Cells, key: FieldKey) { return cells.get(MEMORY_FIELDS[key].name) ?? ""; }

function readBusiness(cells: Cells, row: number, issues: Issue[], allowDefault: boolean): Pick<MemoryRow, (typeof editableFields)[number] | (typeof immutableFields)[number]> {
  const scope = cell(cells, "scope") as MemoryScope;
  const project_id = cell(cells, "project_id");
  const key = cell(cells, "key");
  const status = (cell(cells, "status") || (allowDefault ? "active" : "")) as MemoryStatus;
  const title = cell(cells, "title");
  const value = cell(cells, "value");
  const source = cell(cells, "source");
  if (scope !== "personal" && scope !== "project") issues.push({ row, code: "invalid_scope", field: MEMORY_FIELDS.scope.name });
  else if (!validMemoryIdentity(scope, project_id)) issues.push({ row, code: "invalid_project", field: MEMORY_FIELDS.project_id.name });
  if (!key || key.length > MEMORY_LIMITS.key || !MEMORY_KEY_PATTERN.test(key)) issues.push({ row, code: "invalid_key", field: MEMORY_FIELDS.key.name });
  if (status !== "active" && status !== "archived") issues.push({ row, code: "invalid_status", field: MEMORY_FIELDS.status.name });
  for (const [field, text] of Object.entries({ title, value, source }) as ["title" | "value" | "source", string][]) {
    if (!text || text.length > MEMORY_LIMITS[field]) issues.push({ row, code: "invalid_text", field: MEMORY_FIELDS[field].name });
  }
  return { scope, project_id, key, status, title, value, source };
}

function writeRow(cells: Cells, row: MemoryRow) {
  for (const key of Object.keys(MEMORY_FIELDS) as FieldKey[]) cells.set(MEMORY_FIELDS[key].name, String(row[key]));
}

function emptyCells(cells: Cells) { return [...cells.values()].every((value) => !value); }

function fieldDefinitions(yaml: string | null, addMissing: boolean): string {
  const document = yaml === null ? new Document({}) : parseDocument(yaml);
  if (document.errors.length) throw new MemoryTableError("invalid_fields");
  const existing = document.get("fields", true);
  if (existing !== undefined && !isMap(existing)) throw new MemoryTableError("invalid_fields");
  const fields = existing as YAMLMap | undefined ?? document.createNode({}) as YAMLMap;
  let changed = existing === undefined;
  const issues: Issue[] = [];
  for (const field of Object.values(MEMORY_FIELDS)) {
    const value = fields.get(field.name, true);
    if (!value && addMissing) {
      fields.set(field.name, document.createNode("options" in field ? { type: field.type, options: [...field.options] } : { type: field.type }));
      changed = true;
    } else if (!isMap(value) || value.get("type") !== field.type) {
      issues.push({ row: null, code: "invalid_field_type", field: field.name });
    } else if ("options" in field) {
      const options: unknown = value.toJSON().options;
      if (!Array.isArray(options) || options.length !== field.options.length || field.options.some(option => !options.includes(option))) {
        issues.push({ row: null, code: "invalid_field_options", field: field.name });
      }
    }
  }
  if (issues.length) throw new MemoryTableError("invalid_fields", issues);
  if (!addMissing && document.get(MEMORY_SCHEMA_KEY) !== 1) throw new MemoryTableError("invalid_fields");
  if (addMissing && document.get(MEMORY_SCHEMA_KEY) !== 1) {
    document.set(MEMORY_SCHEMA_KEY, 1);
    changed = true;
  }
  if (!changed && yaml !== null) return yaml;
  document.set("fields", fields);
  return String(document).trimEnd();
}

function render(source: TableSource, headers: string[], cells: Cells[], yaml: string | null): string {
  const lines = source.body.split(/\r?\n/);
  const table = renderTable(headers, cells.map((row) => headers.map((header) => row.get(header) ?? ""))).split("\n");
  if (source.parsed) {
    if (headers.length === source.headers.length && headers.every((header, index) => source.headers[index] === header)) table[1] = lines[source.parsed.start + 1]!;
    lines.splice(source.parsed.start, source.parsed.end - source.parsed.start + 1, ...table);
  } else {
    if (source.body.trim()) lines.push("");
    lines.push(...table);
  }
  const body = lines.join("\n").trimStart();
  return `${yaml === null ? "" : `---\n${yaml}\n---\n`}\n${body}`;
}

export function prepareMemoryBinding(markdown: string, now: number) {
  const source = openTable(markdown);
  const columnsToAdd = requiredColumns.filter((name) => !source.headers.includes(name));
  const headers = [...source.headers, ...columnsToAdd];
  const issues: Issue[] = [];
  let yaml = source.yaml;
  try { yaml = fieldDefinitions(source.yaml, true); }
  catch (error) {
    if (!(error instanceof MemoryTableError)) throw error;
    issues.push(...(error.issues.length ? error.issues : [{ row: null, code: error.code }]));
  }
  const keys = new Set<string>();
  const ids = new Set<string>();
  const rows: Cells[] = [];
  source.cells.forEach((cells, index) => {
    if (emptyCells(cells)) return;
    const row = index + 1;
    const business = readBusiness(cells, row, issues, true);
    const identity = memoryIdentity(business);
    if (keys.has(identity)) issues.push({ row, code: "key_exists", field: MEMORY_FIELDS.key.name });
    keys.add(identity);
    const id = cell(cells, "id") || crypto.randomUUID();
    if (ids.has(id) || !validRowId(id)) issues.push({ row, code: "invalid_row_id", field: MEMORY_FIELDS.id.name });
    ids.add(id);
    const row_rev = Number(cell(cells, "row_rev")) || 1;
    if (!Number.isSafeInteger(row_rev) || row_rev < 1) issues.push({ row, code: "invalid_row_version", field: MEMORY_FIELDS.row_rev.name });
    writeRow(cells, { ...business, id, row_rev, updated_at: new Date(now).toISOString(), updated_by: "用户" });
    rows.push(cells);
  });
  return { columnsToAdd, rowCount: rows.length, issues, markdown: issues.length ? markdown : render(source, headers, rows, yaml) };
}

function validRowId(id: string) { return /^[a-z0-9_-]{1,128}$/i.test(id); }

export function readMemoryDocument(markdown: string) {
  const source = openTable(markdown);
  if (!source.parsed || requiredColumns.some((name) => !source.headers.includes(name))) throw new MemoryTableError("missing_columns");
  fieldDefinitions(source.yaml, false);
  const issues: Issue[] = [];
  const keys = new Set<string>();
  const ids = new Set<string>();
  const rows = source.cells.map((cells, index) => {
    const row = index + 1;
    const business = readBusiness(cells, row, issues, false);
    const id = cell(cells, "id");
    const row_rev = Number(cell(cells, "row_rev"));
    const updated_at = cell(cells, "updated_at");
    const updated_by = cell(cells, "updated_by");
    const identity = memoryIdentity(business);
    if (keys.has(identity)) issues.push({ row, code: "key_exists" });
    if (!validRowId(id) || ids.has(id)) issues.push({ row, code: "invalid_row_id" });
    if (!Number.isSafeInteger(row_rev) || row_rev < 1 || !Number.isFinite(Date.parse(updated_at)) || !updated_by) {
      issues.push({ row, code: "invalid_row_version" });
    }
    keys.add(identity);
    ids.add(id);
    return { ...business, id, row_rev, updated_at, updated_by };
  });
  if (issues.length) throw new MemoryTableError("invalid_rows", issues);
  return { source, rows };
}

export function updateMemoryDocument(document: ReturnType<typeof readMemoryDocument>, row: MemoryRow) {
  const { source, rows } = document;
  const index = rows.findIndex(({ id }) => id === row.id);
  const target = index === -1 ? new Map<string, string>() : source.cells[index]!;
  writeRow(target, row);
  if (index === -1) source.cells.push(target);
  return render(source, source.headers, source.cells, source.yaml);
}

/** Three-way merge of owner edits. Omission only deletes rows present in the owner's base. */
export function mergeOwnerMemoryEdit(baseMarkdown: string, currentMarkdown: string, nextMarkdown: string, now: number) {
  const current = readMemoryDocument(currentMarkdown);
  const base = openTable(baseMarkdown);
  const proposed = openTable(nextMarkdown);
  const nextYaml = fieldDefinitions(proposed.yaml, false);
  if (!proposed.parsed || requiredColumns.some((name) => !proposed.headers.includes(name))) throw new MemoryTableError("missing_columns");

  const structure = (source: TableSource) => JSON.stringify([source.yaml, source.headers, borderText(source)]);
  const structureChanged = structure(proposed) !== structure(base);
  if (structureChanged && structure(current.source) !== structure(base) && structure(current.source) !== structure(proposed)) {
    throw new MemoryTableError("row_conflict");
  }
  const target = structureChanged ? proposed : current.source;
  const baseRows = new Map(base.cells.filter((cells) => cell(cells, "id")).map((cells) => [cell(cells, "id"), cells]));
  const originalOrder = current.rows.map((row) => row.id);
  const rows = new Map(current.rows.map((row, index) => [row.id, { row, cells: current.source.cells[index]! }]));
  const seen = new Set<string>();
  const order: string[] = [];
  let conflict = false;
  const stamp = new Date(now).toISOString();
  const sameExistingEdit = (before: Cells, authoritative: Cells) => target.headers.every((name) =>
    managedMetadata.has(name) || (before.get(name) ?? "") === (authoritative.get(name) ?? ""));

  for (const draft of proposed.cells) {
    if (emptyCells(draft)) continue;
    const draftId = cell(draft, "id");
    if (draftId && (seen.has(draftId) || !validRowId(draftId))) throw new MemoryTableError("invalid_row_id");
    const prior = baseRows.get(draftId);
    const live = rows.get(draftId);
    const touched = target.headers.filter((name) =>
      !managedMetadata.has(name) && (draft.get(name) ?? "") !== (prior?.get(name) ?? ""));
    if (draftId) seen.add(draftId);
    if (prior && !touched.length) {
      if (live) order.push(draftId);
      continue;
    }
    if (prior && (!live || Number(cell(prior, "row_rev")) !== live.row.row_rev || !sameExistingEdit(prior, live.cells))) {
      conflict = true;
      if (live) order.push(draftId);
      continue;
    }
    if (!prior && live) {
      if (!sameExistingEdit(draft, live.cells)) conflict = true;
      order.push(draftId);
      continue;
    }
    const cells = live ? new Map(live.cells) : new Map(draft);
    for (const name of touched) cells.set(name, draft.get(name) ?? "");
    const issues: Issue[] = [];
    const business = readBusiness(cells, order.length + 1, issues, !live);
    if (issues.length) throw new MemoryTableError("invalid_rows", issues);
    if (live && immutableFields.some((field) => business[field] !== live.row[field])) throw new MemoryTableError("immutable_identity");
    const id = live?.row.id ?? (draftId || crypto.randomUUID());
    const row = { ...business, id, row_rev: (live?.row.row_rev ?? 0) + 1, updated_at: stamp, updated_by: "用户" };
    writeRow(cells, row);
    rows.set(id, { row, cells });
    order.push(id);
  }
  for (const [id, previous] of baseRows) {
    if (seen.has(id)) continue;
    const live = rows.get(id);
    if (live && (live.row.row_rev !== Number(cell(previous, "row_rev")) || !sameExistingEdit(previous, live.cells))) {
      conflict = true;
      continue;
    }
    rows.delete(id);
  }
  const keys = new Set<string>();
  for (const { row } of rows.values()) {
    const key = memoryIdentity(row);
    if (keys.has(key)) throw new MemoryTableError("key_exists");
    keys.add(key);
  }
  const baseOrder = [...baseRows.keys()].filter((id) => seen.has(id));
  const draftOrder = order.filter((id) => baseRows.has(id));
  const reordered = JSON.stringify(baseOrder) !== JSON.stringify(draftOrder);
  const ids = new Set(reordered ? [...order, ...originalOrder] : [...originalOrder, ...order]);
  const cells = [...ids].flatMap((id) => rows.has(id) ? [rows.get(id)!.cells] : []);
  return { markdown: render(target, target.headers, cells, structureChanged ? nextYaml : target.yaml), conflict };
}

const managedMetadata = new Set(MEMORY_SYSTEM_COLUMNS);

function borderText(source: TableSource) {
  const lines = source.body.split(/\r?\n/);
  if (source.parsed) lines.splice(source.parsed.start, source.parsed.end - source.parsed.start + 1);
  return lines.join("\n").trim();
}
