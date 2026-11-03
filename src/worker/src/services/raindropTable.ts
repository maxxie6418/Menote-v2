import { BOOKMARK_COLUMNS, BOOKMARK_ROW_ID_COLUMN, type RaindropMappedFields } from "@menote/shared";
import { findTable, generateRowId, renderTable, splitFrontmatter, toTableCell } from "./tableMarkdown";

/** 绑定表格的行级读写（TP9）：以「行 ID」列为本地行锚点；保留用户自建列与未知列，不重排列序。 */

const COLUMN_NAMES = BOOKMARK_COLUMNS.map((column) => column.name);

function ensureColumns(headers: string[]): string[] {
  const next = [...headers];
  for (const name of [...COLUMN_NAMES, BOOKMARK_ROW_ID_COLUMN]) {
    if (!next.includes(name)) next.push(name);
  }
  return next;
}

export interface RaindropRow {
  /** 「行 ID」列的值；缺失（存量行未回填）为 null。 */
  rowId: string | null;
  /** 以列名为键的原始单元格文本。 */
  cells: Record<string, string>;
}

/** 读取首张表格的全部数据行；表格不存在时返回空数组。 */
export function readRows(markdown: string): RaindropRow[] {
  const { body } = splitFrontmatter(markdown);
  const parsed = findTable(body);
  if (!parsed) return [];
  return parsed.rows.map((cells) => {
    const record: Record<string, string> = {};
    parsed.headers.forEach((header, index) => { record[header] = cells[index] ?? ""; });
    return { rowId: record[BOOKMARK_ROW_ID_COLUMN] || null, cells: record };
  });
}

/** 为缺「行 ID」列/值的行回填新 ID；返回新 Markdown 与「下标 → 行 ID」映射（按数据行顺序）。 */
export function backfillRowIds(markdown: string): { markdown: string; rowIds: string[] } {
  const { yaml, body } = splitFrontmatter(markdown);
  const parsed = findTable(body);
  if (!parsed) {
    const headers = ensureColumns([]);
    const empty = renderTable(headers, []);
    return { markdown: joinFrontmatter(yaml, `${empty}\n`), rowIds: [] };
  }
  const headers = ensureColumns(parsed.headers);
  const idIndex = headers.indexOf(BOOKMARK_ROW_ID_COLUMN);
  const rowIds: string[] = [];
  const rows = parsed.rows.map((cells) => {
    const padded = headers.map((_, index) => cells[index] ?? "");
    padded[idIndex] = padded[idIndex] || generateRowId();
    rowIds.push(padded[idIndex]);
    return padded;
  });
  const nextTable = renderTable(headers, rows).split("\n");
  const lines = body.split(/\r?\n/);
  lines.splice(parsed.start, parsed.end - parsed.start + 1, ...nextTable);
  return { markdown: joinFrontmatter(yaml, lines.join("\n")), rowIds };
}

export interface RowWrite {
  rowId: string;
  fields: RaindropMappedFields;
}

/** 按「行 ID」更新已存在行、追加新行；一次重建整表（调用方经 applyOperation 提交，冲突时不落盘）。 */
export function upsertRows(markdown: string, updates: RowWrite[], appends: RowWrite[]): string {
  const { yaml, body } = splitFrontmatter(markdown);
  const parsed = findTable(body);
  const headers = parsed ? ensureColumns(parsed.headers) : ensureColumns([]);
  const updateByRowId = new Map(updates.map((write) => [write.rowId, write]));
  const idIndex = headers.indexOf(BOOKMARK_ROW_ID_COLUMN);
  const rows: string[][] = [];
  for (const row of parsed?.rows ?? []) {
    const padded = headers.map((_, index) => row[index] ?? "");
    const write = padded[idIndex] ? updateByRowId.get(padded[idIndex]) : undefined;
    if (write) {
      for (const [name, value] of Object.entries(fieldsToCells(write.fields))) {
        padded[headers.indexOf(name)] = value;
      }
    }
    rows.push(padded);
  }
  for (const write of appends) {
    const cells = fieldsToCells(write.fields);
    cells[BOOKMARK_ROW_ID_COLUMN] = write.rowId;
    rows.push(headers.map((header) => cells[header] ?? ""));
  }
  const nextTable = renderTable(headers, rows).split("\n");
  if (parsed) {
    const lines = body.split(/\r?\n/);
    lines.splice(parsed.start, parsed.end - parsed.start + 1, ...nextTable);
    return joinFrontmatter(yaml, lines.join("\n"));
  }
  const prefix = body.trimEnd();
  return joinFrontmatter(yaml, `${prefix}${prefix ? "\n\n" : ""}${nextTable.join("\n")}\n`);
}

/** 映射字段 → 单元格文本（列名键；与插件写入路径同一序列化规则）。 */
export function fieldsToCells(fields: RaindropMappedFields): Record<string, string> {
  return {
    标题: fields.title, 网址: fields.link, 摘要: fields.excerpt, 备注: fields.note,
    标签: fields.tags.join(", "), 类型: fields.type, 封面: fields.cover,
    采集时间: fields.capturedAt, 重要: String(fields.important),
  };
}

/** 单元格文本 → 映射字段（用户编辑后的行内容以列名回读；缺失列按空值处理）。 */
export function fieldsFromCells(cells: Record<string, string>): RaindropMappedFields {
  const text = (name: string) => (cells[name] ?? "").trim();
  return {
    title: text("标题"), link: text("网址"), excerpt: text("摘要"), note: text("备注"),
    tags: text("标签") ? text("标签").split(",").map((tag) => tag.trim()).filter(Boolean) : [],
    type: text("类型") || "link", cover: text("封面"),
    capturedAt: text("采集时间"), important: text("重要") === "true",
  };
}

function joinFrontmatter(yaml: string | null, body: string): string {
  return yaml === null ? body : `---\n${yaml}\n---\n\n${body.trimStart()}`;
}
