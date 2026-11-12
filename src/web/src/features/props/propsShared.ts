import type { PropRow, PropertyDef, PropertyTemplate, PropertyType } from "../../lib/frontmatter";

/** 属性区的共用取值：类型标签、类型推断、值归一化、定义保留、分组。 */

export const TYPE_LABELS: Record<PropertyType, string> = {
  text: "文本",
  multiline: "多行文本",
  number: "数字",
  date: "日期",
  select: "单选",
  multiselect: "多选",
  checkbox: "复选框",
  link: "链接",
  attachment: "附件",
};

/**
 * 双列的最小栏宽（CSS 像素）：两台 207px 值列 + 96 键列 + 24 栏距。
 * 按「文档栏宽」判断而不是窗口宽度——移动端、窄窗、分栏时同样生效。
 * 2026-11-12 起用于「两列网格」的回落阈值（竖线一并收掉）。
 */
export const PROPS_TWO_COLUMN_MIN = 560;

/* ---------- 区域归属（2026-11-12 负责人确认的 C 方案） ---------- */

/** 带·左组：判定类。一眼可判、宽度固定（选中项是个闭合值域）。 */
export const STRIP_LEFT_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>(["select", "checkbox"]);

/** 带·右组：归属类。回答「谁·哪·何时·多少」，与左组两端分布。 */
export const STRIP_RIGHT_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>(["text", "link", "date", "number"]);

/**
 * 文本/链接进带的长度上限（字符）。
 * 同样是 text，作者进带、标题落网格——按值长度分流，判据确定，不看渲染宽度猜。
 */
export const STRIP_TEXT_MAX = 40;

/** 多选在网格里并排的最大项数；超过就跨满（chips 会换行，行高就不稳）。 */
export const GRID_MULTI_PAIR_MAX = 2;

/** 空值：布尔只为真作证，多选看项数，其余看去空后的字符串。带内过滤、网格保留行。 */
export function isBlankValue(row: PropRow): boolean {
  if (row.isBoolean) return row.raw !== "true";
  if (row.isArray) return row.arrayValues.length === 0;
  return row.raw.trim() === "";
}

/**
 * 该行是否进带（含左右两组）。空值不进——带是摘要，只为「有」作证；
 * 长文本也不进，否则标题会把带撑歪。
 */
export function isStripRow(row: PropRow, type: PropertyType): boolean {
  if (isBlankValue(row)) return false;
  if (STRIP_LEFT_TYPES.has(type)) return true;
  if (!STRIP_RIGHT_TYPES.has(type)) return false;
  if (type === "text" || type === "link") return row.raw.trim().length <= STRIP_TEXT_MAX;
  return true;
}

/** 只把 http(s) 当链接，避免把其它字符串做成可点地址。 */
export function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/.test(value);
}

/** FR-PROP-6 安全推断：仅当控件可无损写回原值时启用对应控件，否则文本。 */
export function inferType(row: PropRow): PropertyType {
  if (row.isBoolean) return "checkbox";
  if (row.isArray) return "multiselect";
  if (/^\d{4}-\d{2}-\d{2}$/.test(row.raw)) return "date";
  if (/^[+-]?\d+(\.\d+)?$/.test(row.raw)) return "number";
  if (isHttpUrl(row.raw)) return "link";
  return "text";
}

/** 改类型时保留显示名；不是单选/多选就把候选值丢掉（否则会留下用不上的残渣）。 */
export function keptDef(row: PropRow, type: PropertyType, options?: string[]): PropertyDef {
  return {
    type,
    ...(row.def?.label ? { label: row.def.label } : {}),
    ...(options && options.length ? { options } : {}),
  };
}

/** 按组归拢预设（组内保持原顺序；无组的排在最后）。 */
export function groupTemplates(templates: PropertyTemplate[]): Array<{ group: string; items: PropertyTemplate[] }> {
  const groups = new Map<string, PropertyTemplate[]>();
  for (const template of templates) {
    const key = template.group ?? "未分组";
    const list = groups.get(key) ?? [];
    list.push(template);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items }));
}
