import { Document, isMap, parseDocument, YAMLMap } from "yaml";
import { BOOKMARK_COLUMNS, BOOKMARK_ROW_ID_COLUMN, type McpBookmarkRequest } from "@menote/shared";
import { findTable, generateRowId, renderTable, splitFrontmatter, toTableCell } from "./tableMarkdown";

function appendToTable(body: string, bookmark: McpBookmarkRequest): string {
  const parsed = findTable(body);
  let headers: string[];
  let rows: string[][];
  let start: number;
  let end: number;
  if (parsed) {
    ({ headers, rows, start, end } = parsed);
  } else {
    // A table item with a non-empty but unparseable table must never be
    // silently rewritten as a second table: the client would then degrade it.
    if (body.split(/\r?\n/).some((line) => line.trim().startsWith("|"))) {
      throw new Error("bookmark_target_invalid");
    }
    headers = [];
    rows = [];
    start = -1;
    end = -1;
  }
  for (const column of BOOKMARK_COLUMNS) if (!headers.includes(column.name)) headers.push(column.name);
  if (!headers.includes(BOOKMARK_ROW_ID_COLUMN)) headers.push(BOOKMARK_ROW_ID_COLUMN);
  const record: Record<string, string | string[] | boolean> = {
    标题: bookmark.title, 网址: bookmark.link, 摘要: bookmark.excerpt ?? "", 备注: bookmark.note ?? "",
    标签: bookmark.tags, 类型: bookmark.type, 封面: bookmark.cover ?? "", 采集时间: bookmark.capturedAt,
    重要: bookmark.important, [BOOKMARK_ROW_ID_COLUMN]: generateRowId(),
  };
  const cells = headers.map((header) => toTableCell(record[header] ?? ""));
  const newRows = [...rows.map((row) => headers.map((_, index) => row[index] ?? "")), cells];
  const nextTable = renderTable(headers, newRows).split("\n");
  if (start < 0) return `${body.trimEnd()}${body.trim() ? "\n\n" : ""}${nextTable.join("\n")}\n`;
  const lines = body.split(/\r?\n/);
  lines.splice(start, end - start + 1, ...nextTable);
  return lines.join("\n");
}

function addFieldDefinitions(yamlSource: string | null): string {
  const document = yamlSource === null ? new Document({}) : parseDocument(yamlSource);
  if (document.errors.length) throw new Error("bookmark_target_invalid");
  const fields = document.get("fields", true);
  if (fields !== undefined && !isMap(fields)) throw new Error("bookmark_target_invalid");
  let map: YAMLMap;
  if (isMap(fields)) map = fields as YAMLMap;
  else {
    map = document.createNode({}) as YAMLMap;
    document.set("fields", map);
  }
  for (const column of BOOKMARK_COLUMNS) {
    if (map.has(column.name)) continue;
    const definition = column.options
      ? { type: column.type, options: [...column.options] }
      : { type: column.type };
    map.set(column.name, document.createNode(definition));
  }
  return String(document).trimEnd();
}

export function appendBookmarkToTable(markdown: string, bookmark: McpBookmarkRequest): string {
  const { yaml, body } = splitFrontmatter(markdown);
  if (body.trim() && !body.split(/\r?\n/).some((line) => line.trim().startsWith("|"))) {
    throw new Error("bookmark_target_invalid");
  }
  const nextYaml = addFieldDefinitions(yaml);
  const nextBody = appendToTable(body, bookmark);
  return `---\n${nextYaml}\n---\n\n${nextBody.trimStart()}`;
}

export function appendBookmarkToNote(markdown: string, bookmark: McpBookmarkRequest): string {
  const { yaml, body } = splitFrontmatter(markdown);
  const safeData = new Document({
    id: bookmark.operationId, title: bookmark.title, url: bookmark.link,
    excerpt: bookmark.excerpt ?? "", note: bookmark.note ?? "", tags: bookmark.tags,
    type: bookmark.type, cover: bookmark.cover ?? "", captured_at: bookmark.capturedAt,
    important: bookmark.important,
  });
  const record = `<!-- menote-bookmark:${bookmark.operationId} -->\n\n\`\`\`yaml\n${String(safeData).trimEnd()}\n\`\`\``;
  const hasSection = /(^|\n)## 网址收藏\s*(\n|$)/.test(body);
  const nextBody = `${body.trimEnd()}${body.trim().length ? "\n\n" : ""}${hasSection ? "" : "## 网址收藏\n\n"}${record}\n`;
  return yaml === null ? nextBody : `---\n${yaml}\n---\n\n${nextBody}`;
}
