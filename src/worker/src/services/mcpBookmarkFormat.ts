import { Document, isMap, parseDocument, YAMLMap } from "yaml";
import type { McpBookmarkRequest } from "@menote/shared";

const COLUMNS = [
  { name: "标题", type: "text" }, { name: "网址", type: "link" }, { name: "摘要", type: "text" },
  { name: "备注", type: "text" }, { name: "标签", type: "multiselect" }, { name: "类型", type: "select" },
  { name: "封面", type: "link" }, { name: "采集时间", type: "date" }, { name: "重要", type: "checkbox" },
] as const;

function splitFrontmatter(markdown: string): { yaml: string | null; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(markdown);
  return match ? { yaml: match[1]!, body: markdown.slice(match[0].length) } : { yaml: null, body: markdown };
}

function toTableCell(value: string | string[] | boolean): string {
  const raw = Array.isArray(value) ? value.join(", ") : String(value);
  return raw.replace(/[\r\n]+/g, " ").replace(/\|/g, "\\|").trim();
}

function parseTableRow(line: string): string[] {
  const content = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let value = "";
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === "\\" && content[i + 1] === "|") { value += "|"; i += 1; }
    else if (content[i] === "|") { cells.push(value.trim()); value = ""; }
    else value += content[i];
  }
  cells.push(value.trim());
  return cells;
}

function isDelimiter(line: string): boolean {
  const cells = parseTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

function renderTable(headers: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.map(toTableCell).join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

function appendToTable(body: string, bookmark: McpBookmarkRequest): string {
  const lines = body.split(/\r?\n/);
  let start = -1;
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (lines[index]!.trim().startsWith("|") && isDelimiter(lines[index + 1]!)) { start = index; break; }
  }
  let headers: string[];
  let rows: string[][];
  let end = -1;
  if (start >= 0) {
    headers = parseTableRow(lines[start]!);
    end = start + 1;
    rows = [];
    while (end + 1 < lines.length && lines[end + 1]!.trim().startsWith("|")) {
      end += 1;
      rows.push(parseTableRow(lines[end]!));
    }
  } else {
    // A table item with a non-empty but unparseable table must never be
    // silently rewritten as a second table: the client would then degrade it.
    if (body.split(/\r?\n/).some((line) => line.trim().startsWith("|"))) {
      throw new Error("bookmark_target_invalid");
    }
    headers = [];
    rows = [];
  }
  for (const column of COLUMNS) if (!headers.includes(column.name)) headers.push(column.name);
  const record: Record<string, string | string[] | boolean> = {
    标题: bookmark.title, 网址: bookmark.link, 摘要: bookmark.excerpt ?? "", 备注: bookmark.note ?? "",
    标签: bookmark.tags, 类型: bookmark.type, 封面: bookmark.cover ?? "", 采集时间: bookmark.capturedAt,
    重要: bookmark.important,
  };
  const cells = headers.map((header) => toTableCell(record[header] ?? ""));
  const newRows = [...rows.map((row) => headers.map((_, index) => row[index] ?? "")), cells];
  const nextTable = renderTable(headers, newRows).split("\n");
  if (start < 0) return `${body.trimEnd()}${body.trim() ? "\n\n" : ""}${nextTable.join("\n")}\n`;
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
  for (const column of COLUMNS) {
    if (map.has(column.name)) continue;
    const definition = column.name === "类型"
      ? { type: column.type, options: ["link", "article", "image", "video", "document", "audio"] }
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
