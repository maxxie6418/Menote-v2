import { splitMultiCell } from "../../lib/gfmTable";
import type { PropertyDef, PropertyType } from "../../lib/frontmatter";

export interface GridField {
  type: PropertyType;
  name?: string;
  def?: PropertyDef;
}

export interface GridCellAddress {
  row: number;
  col: number;
}

/** Excel/Sheets clipboard convention: tabs separate cells and line breaks separate rows. */
export function parseGridClipboard(text: string): string[][] {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (!normalized) return [];
  return normalized.split("\n").map((line) => line.split("\t"));
}

export function validateGridPaste(rows: string[][], start: GridCellAddress, fields: GridField[]): string | null {
  if (!rows.length || rows.some((row) => row.length === 0)) return "剪贴板中没有可粘贴的单元格";
  const maxWidth = Math.max(...rows.map((row) => row.length));
  if (start.col + maxWidth > fields.length) return "粘贴区域超出字段范围，请先添加字段";

  for (let r = 0; r < rows.length; r += 1) {
    for (let c = 0; c < rows[r]!.length; c += 1) {
      const value = rows[r]![c]!.trim();
      const field = fields[start.col + c]!;
      const label = `第 ${start.row + r + 1} 行「${field.name || field.def?.label || "字段"}」`;
      if (!value) continue;
      if (field.type === "number" && (!Number.isFinite(Number(value)) || value.length === 0)) return `${label}不是有效数字：${value}`;
      if (field.type === "date" && !isIsoDate(value)) return `${label}不是有效日期（YYYY-MM-DD）：${value}`;
      if (field.type === "checkbox" && value !== "true" && value !== "false") return `${label}只接受 true 或 false：${value}`;
      if (field.type === "select" && (field.def?.options?.length ?? 0) > 0 && !field.def!.options!.includes(value)) {
        return `${label}不在候选值中：${value}`;
      }
      if (field.type === "multiselect") {
        if (value.includes("\n")) return `${label}不能包含换行`;
        const options = field.def?.options ?? [];
        const invalid = splitMultiCell(value).find((item) => options.length > 0 && !options.includes(item));
        if (invalid) return `${label}包含未知候选值：${invalid}`;
      }
    }
  }
  return null;
}

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
  return date.getUTCFullYear() === Number(yearText)
    && date.getUTCMonth() + 1 === Number(monthText)
    && date.getUTCDate() === Number(dayText);
}

export function compareGridValues(left: string, right: string, field: GridField): number {
  if (left === right) return 0;
  if (left === "") return 1;
  if (right === "") return -1;
  if (field.type === "number") {
    const a = Number(left);
    const b = Number(right);
    if (Number.isFinite(a) && Number.isFinite(b)) return a - b;
    if (!Number.isFinite(a) && !Number.isFinite(b)) return left.localeCompare(right, undefined, { numeric: true });
    return Number.isFinite(a) ? -1 : 1;
  }
  if (field.type === "date") return left.localeCompare(right);
  if (field.type === "checkbox") return (left === "true" ? 1 : 0) - (right === "true" ? 1 : 0);
  if (field.type === "select") {
    const options = field.def?.options ?? [];
    const leftRank = options.indexOf(left);
    const rightRank = options.indexOf(right);
    if (leftRank >= 0 || rightRank >= 0) return (leftRank < 0 ? options.length : leftRank) - (rightRank < 0 ? options.length : rightRank);
  }
  if (field.type === "multiselect") {
    const options = field.def?.options ?? [];
    const rank = (value: string) => splitMultiCell(value).map((item) => {
      const at = options.indexOf(item);
      return at < 0 ? options.length : at;
    }).sort((a, b) => a - b);
    const a = rank(left);
    const b = rank(right);
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      const diff = (a[i] ?? -1) - (b[i] ?? -1);
      if (diff) return diff;
    }
  }
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

export function matchesGridFilter(value: string, query: string, operator: string, field: GridField): boolean {
  if (!query) return true;
  if (field.type === "checkbox") return query === "true" ? value === "true" : value !== "true";
  if (field.type === "number") {
    const a = Number(value);
    const b = Number(query);
    if (value === "" || !Number.isFinite(a) || !Number.isFinite(b)) return false;
    if (operator === "gt") return a > b;
    if (operator === "lt") return a < b;
    return a === b;
  }
  if (field.type === "date") {
    if (!value) return false;
    const comparison = value.localeCompare(query);
    if (operator === "gt") return comparison > 0;
    if (operator === "lt") return comparison < 0;
    return comparison === 0;
  }
  if (field.type === "select") return operator === "contains" ? value.toLocaleLowerCase().includes(query.toLocaleLowerCase()) : value === query;
  if (field.type === "multiselect") return splitMultiCell(value).includes(query);
  return value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}
