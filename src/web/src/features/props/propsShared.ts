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
 * 类型的默认去向（2026-11-12 负责人要求「第一排只有指定属性可以放」之后）：
 * 只有值域封闭的类型默认进第一排；文本与链接一律默认落网格，
 * 要进第一排必须在属性设置里指定（写入 props 定义），或由预设标 strip。
 * 不再按「值有多长」猜——标题和概述都短，按长度判会把它们塞进第一排。
 */
export const STRIP_DEFAULT_TYPES: ReadonlySet<PropertyType> = new Set<PropertyType>(["select", "checkbox", "date", "number"]);

/** 多选在网格里并排的最大项数；超过就跨满（chips 会换行，行高就不稳）。 */
export const GRID_MULTI_PAIR_MAX = 2;

/**
 * 键名兜底（2026-11-12）：预设只覆盖出厂那几条，剪藏与历史文档会写别的键。
 * 这两个集合只解决「一眼就知道该放哪」的常见键，其余靠属性设置里的「位置」定。
 */
const STRIP_KEYS = new Set(["author", "作者", "site", "site_name", "站点", "来源", "clipped_at", "captured", "收藏", "收藏于", "published_at", "发布时间"]);
const WIDE_KEYS = new Set(["summary", "description", "abstract", "excerpt", "概述", "摘要", "简介", "批注"]);

/** 空值：布尔只为真作证，多选看项数，其余看去空后的字符串。带内过滤、网格保留行。 */
export function isBlankValue(row: PropRow): boolean {
  if (row.isBoolean) return row.raw !== "true";
  if (row.isArray) return row.arrayValues.length === 0;
  return row.raw.trim() === "";
}

/**
 * 该行是否进第一排。优先级：文档里的显式设定 > 预设标记 > 类型默认。
 * 空值一律不进——第一排是摘要，只为「有」作证。
 */
export function isStripRow(row: PropRow, type: PropertyType, preset?: boolean): boolean {
  if (isBlankValue(row)) return false;
  if (typeof row.def?.strip === "boolean") return row.def.strip;
  if (typeof preset === "boolean") return preset;
  if (WIDE_KEYS.has(row.key)) return false;
  if (STRIP_KEYS.has(row.key)) return true;
  return STRIP_DEFAULT_TYPES.has(type);
}

/**
 * 该行是否独享整排（文本类还会按两行显示）。概述/摘要固定走这条，
 * 并排在网格最后，不参与两两配对。
 */
export function isWideRow(row: PropRow, type: PropertyType, preset?: boolean): boolean {
  if (typeof row.def?.wide === "boolean") return row.def.wide;
  if (typeof preset === "boolean") return preset;
  if (WIDE_KEYS.has(row.key)) return true;
  return type === "multiline" || type === "attachment";
}

/** 显示位置：第一排 / 并列配对 / 独享整排（属性设置里的三选项）。 */
export type PropPlacement = "strip" | "pair" | "wide";

export function placementOf(row: PropRow, type: PropertyType, preset?: { strip?: boolean; wide?: boolean }): PropPlacement {
  if (isStripRow(row, type, preset?.strip)) return "strip";
  if (isWideRow(row, type, preset?.wide)) return "wide";
  return "pair";
}

/** 位置的显式设定：写进 props 定义，strip 与 wide 互斥。 */
export function placementDef(placement: PropPlacement): Pick<PropertyDef, "strip" | "wide"> {
  if (placement === "strip") return { strip: true, wide: false };
  if (placement === "wide") return { strip: false, wide: true };
  return { strip: false, wide: false };
}

/** 改类型时保留显示名；不是单选/多选就把候选值丢掉（否则会留下用不上的残渣）。 */
export function keptDef(row: PropRow, type: PropertyType, options?: string[]): PropertyDef {
  return {
    type,
    ...(row.def?.label ? { label: row.def.label } : {}),
    ...(options && options.length ? { options } : {}),
    ...(typeof row.def?.strip === "boolean" ? { strip: row.def.strip } : {}),
    ...(typeof row.def?.wide === "boolean" ? { wide: row.def.wide } : {}),
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
