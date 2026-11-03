/** GFM 表格 Markdown 的纯解析/序列化工具（TP3 收藏写入与 TP9 连接器共用）。
 *  仅处理「首张可解析表格」；转义规则与 Menote 表格文档的序列化保持一致。 */

export function splitFrontmatter(markdown: string): { yaml: string | null; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(markdown);
  return match ? { yaml: match[1]!, body: markdown.slice(match[0].length) } : { yaml: null, body: markdown };
}

export function toTableCell(value: string | string[] | boolean): string {
  const raw = Array.isArray(value) ? value.join(", ") : String(value);
  return raw.replace(/[\r\n]+/g, " ").replace(/\|/g, "\\|").trim();
}

export function parseTableRow(line: string): string[] {
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

export function isDelimiter(line: string): boolean {
  const cells = parseTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

export interface ParsedTable {
  headers: string[];
  rows: string[][];
  /** 在 body 行数组中的起止下标（含首尾）。 */
  start: number;
  end: number;
}

/** 定位 body 中第一张「表头 + 分隔行」结构的表格；找不到返回 null（调用方自行决定报错或新建）。 */
export function findTable(body: string): ParsedTable | null {
  const lines = body.split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index]!.trim().startsWith("|") || !isDelimiter(lines[index + 1]!)) continue;
    const headers = parseTableRow(lines[index]!);
    let end = index + 1;
    const rows: string[][] = [];
    while (end + 1 < lines.length && lines[end + 1]!.trim().startsWith("|")) {
      end += 1;
      rows.push(parseTableRow(lines[end]!));
    }
    return { headers, rows, start: index, end };
  }
  return null;
}

export function renderTable(headers: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.map(toTableCell).join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

/** 行 ID：短随机 base64url（11 字符），由服务端在写行时生成；仅作为账本锚点，不含业务含义。 */
export function generateRowId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
