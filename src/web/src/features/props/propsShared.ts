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
};

/**
 * 双列的最小栏宽（CSS 像素）：两台 207px 值列 + 96 键列 + 24 栏距。
 * 按「文档栏宽」判断而不是窗口宽度——移动端、窄窗、分栏时同样生效。
 */
export const PROPS_TWO_COLUMN_MIN = 560;

/** 长值类型整行跨列（双列布局）；其余短值两两并排。 */
export const SPAN_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>(["link", "multiline"]);

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
