import { FIELDS_KEY, OPTION_COLORS, parseOptionList, replaceMarkdownBody, splitFrontmatter, writeDef, type PropertyDef } from "../../lib/frontmatter";
import { joinMultiCell, replaceTable, splitMultiCell, type ParsedTable } from "../../lib/gfmTable";

export function withChoiceOptions(def: PropertyDef, values: Iterable<string>): PropertyDef {
  const options = new Set(def.options);
  const colors = new Map(Object.entries(def.optionColors ?? {}));
  for (const value of values) {
    if (!value || value.includes(",") || options.has(value)) continue;
    if (!colors.has(value)) colors.set(value, OPTION_COLORS[1 + options.size % (OPTION_COLORS.length - 1)]!);
    options.add(value);
  }
  return { ...def, options: [...options], optionColors: Object.fromEntries(colors) };
}

/** 旧的收藏表可以只声明多选类型。读取时从已有值补候选，浏览本身不改文档。 */
export function displayFieldDefs(defs: Record<string, PropertyDef>, table?: ParsedTable) {
  const result = { ...defs };
  table?.header.forEach((name, col) => {
    const def = defs[name.trim()];
    if (!def || def.options !== undefined || (def.type !== "select" && def.type !== "multiselect")) return;
    const values = table.rows.flatMap(row => def.type === "select" ? [row[col] ?? ""] : splitMultiCell(row[col] ?? ""));
    result[name.trim()] = withChoiceOptions(def, values);
  });
  return result;
}

export function convertChoiceColumn(markdown: string, name: string, col: number, table: ParsedTable | undefined,
  type: "select" | "multiselect", previous?: PropertyDef): string {
  const def = { ...previous, type };
  const candidates = new Set<string>();
  const known = new Set(previous?.options);
  let changed = false;
  const rows = table?.rows.map(row => {
    const value = row[col] ?? "";
    if (!value) return row;
    // 已有类型化标签中的分号等字符属于标签名，只有从文本转换时才按导入分隔符拆分。
    const tags = type === "select" || known.has(value) ? [value]
      : previous?.type === "multiselect" ? splitMultiCell(value) : parseOptionList(value.replace(/、/g, "，"));
    for (const tag of tags) candidates.add(tag);
    const next = type === "select" ? value : joinMultiCell([...new Set(tags)]);
    if (next === value) return row;
    changed = true;
    const copy = [...row];
    copy[col] = next;
    return copy;
  });
  let next = writeDef(markdown, FIELDS_KEY, name, withChoiceOptions(def, candidates));
  if (changed && table && rows) next = replaceMarkdownBody(next, replaceTable(splitFrontmatter(next).body, 0, { ...table, rows }));
  return next;
}

/** 日期按源日历显示，带偏移的时间保留其源时区；打开控件本身不重写精度。 */
export function parseTableDate(value: string) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ]((?:[01]\d|2[0-3]):[0-5]\d)(:[0-5]\d(?:\.\d+)?)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/.exec(value);
  if (!m) return null;
  const day = m[1]!;
  const date = new Date(day + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) return null;
  return { day, time: m[2] ?? "", seconds: m[3] ?? "", zone: m[4] ?? "" };
}
