/**
 * GFM 表格解析与写回（FR-TBL-1/6）：内容载体永远是标准 GFM 表格。
 * 写回契约：多选 `值A, 值B`（候选由调用方校验禁逗号）；单元格禁换行；竖线转义；值首尾空格不保留。
 */

export interface ParsedTable {
  /** 正文中的起始/结束行号（0 起，含分隔行）。 */
  startLine: number;
  endLine: number;
  header: string[];
  rows: string[][];
}

export function splitRow(line: string): string[] {
  // 按未转义竖线切分；连续反斜线按 GFM 奇偶规则处理。
  const trimmed = line.trim();
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i]!;
    if (char === "\\") {
      let end = i;
      while (trimmed[end + 1] === "\\") end += 1;
      const count = end - i + 1;
      if (trimmed[end + 1] === "|") {
        current += "\\".repeat(Math.floor(count / 2));
        if (count % 2) current += "|";
        else { cells.push(current); current = ""; }
        i = end + 1;
        continue;
      }
      current += "\\".repeat(count);
      i = end;
      continue;
    }
    if (char === "|") { cells.push(current); current = ""; continue; }
    current += char;
  }
  cells.push(current);
  if (trimmed.startsWith("|")) cells.shift();
  let trailingSlashes = 0;
  for (let index = trimmed.length - 2; index >= 0 && trimmed[index] === "\\"; index -= 1) trailingSlashes += 1;
  if (trimmed.endsWith("|") && trailingSlashes % 2 === 0) cells.pop();
  return cells.map((cell) => cell.trim());
}

function isDelimiter(line: string): boolean {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

function hasUnescapedPipe(line: string): boolean {
  let backslashes = 0;
  for (const char of line.trim()) {
    if (char === "\\") { backslashes += 1; continue; }
    if (char === "|" && backslashes % 2 === 0) return true;
    backslashes = 0;
  }
  return false;
}

/** 找出正文中所有可解析的 GFM 表格（表头+分隔+若干行）；不完整的块不视为表格。 */
export function findTables(body: string): ParsedTable[] {
  const lines = body.split(/\r?\n/);
  const tables: ParsedTable[] = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    const line = lines[i]!;
    if (!hasUnescapedPipe(line) || !isDelimiter(lines[i + 1]!)) continue;
    const header = splitRow(line);
    let end = i + 1;
    const rows: string[][] = [];
    for (let j = i + 2; j < lines.length; j += 1) {
      if (!hasUnescapedPipe(lines[j]!)) break;
      rows.push(splitRow(lines[j]!));
      end = j;
    }
    tables.push({ startLine: i, endLine: end, header, rows });
  }
  return tables;
}

function escapeCell(value: string): string {
  return value.replace(/\s*\r?\n\s*/g, " ").replace(/\|/g, "\\|").trim();
}

export function renderTable(header: string[], rows: string[][]): string {
  const width = Math.max(header.length, ...rows.map((row) => row.length));
  const normalize = (row: string[]) => Array.from({ length: width }, (_, i) => escapeCell(row[i] ?? ""));
  const head = normalize(header);
  const lines = [
    `| ${head.join(" | ")} |`,
    `| ${head.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${normalize(row).join(" | ")} |`),
  ];
  return lines.join("\n");
}

/** 用新表格文本替换正文中的第 tableIndex 个表格；不可解析时原样返回（调用方先检查）。 */
export function replaceTable(body: string, tableIndex: number, next: ParsedTable): string {
  const tables = findTables(body);
  const target = tables[tableIndex];
  if (!target) return body;
  const lines = body.split(/\r?\n/);
  const replacement = renderTable(next.header, next.rows).split(/\r?\n/);
  lines.splice(target.startLine, target.endLine - target.startLine + 1, ...replacement);
  return lines.join("\n");
}

/** FR-TBL-6 多选单元格写回：`值A, 值B`；候选含逗号由调用方校验强制。 */
export function joinMultiCell(values: string[]): string {
  return values.map((value) => value.trim()).filter(Boolean).join(", ");
}

export function splitMultiCell(raw: string): string[] {
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

/** 抽出为独立表格文档（FR-TBL-3）：fields 定义 + 表格主体的新文档内容。 */
export function extractTableDoc(header: string[], rows: string[][], fieldDefs: Record<string, { type: string; label?: string; options?: string[] }>): string {
  const fields = Object.keys(fieldDefs).length > 0
    ? `fields:\n${Object.entries(fieldDefs).map(([name, def]) => {
      const options = def.options ? `, options: [${def.options.map((option) => JSON.stringify(option)).join(", ")}]` : "";
      const label = def.label ? `, label: ${JSON.stringify(def.label)}` : "";
      return `  ${JSON.stringify(name)}:\n    type: ${def.type}${label}${options}`;
    }).join("\n")}\n` : "";
  return `${fields}\n${renderTable(header, rows)}\n`;
}
