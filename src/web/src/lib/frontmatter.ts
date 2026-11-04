import { Document, parse as parseYaml, parseDocument, type YAMLMap } from "yaml";

/**
 * Frontmatter 往返（开放项 #5 定稿 + FR-PROP-5/7）：
 * - 保留命名空间：`props`（属性定义）与 `fields`（表格字段定义）；单选/多选候选必须显式定义。
 * - 基于 yaml Document AST：未触碰的键原样保留（含注释与书写风格），编辑过的键按 YAML 规范重排——
 *   语义不变（C-1：不剥离/不静默修正，仅被编辑的值自身重序列化）。
 * - 无法按声明类型解析的值一律文本降级、原样写回（FR-PROP-7）。
 */

export const PROPS_KEY = "props";
export const FIELDS_KEY = "fields";

export type PropertyType =
  | "text" | "multiline" | "number" | "date" | "select" | "multiselect" | "checkbox" | "link";

export const PROPERTY_TYPES: readonly PropertyType[] =
  ["text", "multiline", "number", "date", "select", "multiselect", "checkbox", "link"];

/** 表格侧不提供多行文本（FR-PROP-4）。 */
export const TABLE_FIELD_TYPES: readonly PropertyType[] =
  ["text", "number", "date", "select", "multiselect", "checkbox", "link"];

export interface PropertyDef {
  type: PropertyType;
  label?: string;
  options?: string[];
  optionColors?: Record<string, OptionColor>;
}

export const OPTION_COLORS = ["neutral", "red", "orange", "yellow", "green", "teal", "blue", "purple", "pink"] as const;
export type OptionColor = (typeof OPTION_COLORS)[number];

/**
 * 默认属性模板（FR-PROP-9）：设置里可配的「添加属性」模板库。
 * 与属性定义同源，另带一个默认值（加进文档时写入的值）。
 */
export interface PropertyTemplate {
  id: string;
  /** 键名（写进 YAML 的键）——机器可互通的名称（英文惯例 / Raindrop 标准列名）。 */
  name: string;
  type: PropertyType;
  label?: string;
  options?: string[];
  /** 加进文档时写入的默认值（文本/数字/日期/链接为字符串，复选框为布尔，多选为数组）。 */
  value?: string | boolean | string[];
  /** 分组（设置里按组分栏列出）：剪藏 / Raindrop / 通用。 */
  group?: string;
}

/**
 * 候选值输入的解析（属性区「单选/多选」候选编辑）：
 * 换行、中英文分号、中英文逗号都算分隔符；首尾空格去掉、重复项去重。
 * 空格**不作**分隔符——候选值本身常带空格（"In Progress"、"待评审 重要"），
 * 按空格拆会把值切碎；分号既能一次键入，又与值内可能出现的逗号区分得开。
 */
export function parseOptionList(text: string): string[] {
  const seen = new Set<string>();
  const options: string[] = [];
  for (const part of text.split(/[\n;；,，]+/)) {
    const option = part.trim();
    if (!option || seen.has(option)) continue;
    seen.add(option);
    options.push(option);
  }
  return options;
}

export function splitFrontmatter(markdown: string): { frontText: string | null; body: string } {
  if (!markdown.startsWith("---")) return { frontText: null, body: markdown };
  const end = markdown.indexOf("\n---", 3);
  if (end === -1) return { frontText: null, body: markdown };
  const frontText = markdown.slice(0, end) + "\n---";
  const rest = markdown.slice(end + 4);
  return { frontText, body: rest.startsWith("\n") ? rest.slice(1) : rest };
}

/** 把编辑器里的纯正文拼回属性区管理的 frontmatter（FR-PROP-1）。无属性时原样返回正文。 */
export function joinFrontmatter(frontText: string | null, body: string): string {
  return frontText ? `${frontText}\n\n${body}` : body;
}

/** 解析 frontmatter 数据面；空/损坏 frontmatter 视为无属性（不抛出，C-1 不阻断）。 */
export function parseFrontmatterData(markdown: string): Record<string, unknown> {
  const { frontText } = splitFrontmatter(markdown);
  if (!frontText) return {};
  try {
    const data = parseYaml(frontText.slice(4).replace(/\n---\s*$/, ""));
    return typeof data === "object" && data !== null && !Array.isArray(data) ? data as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function readDefs(markdown: string, namespace: string): Record<string, PropertyDef> {
  const raw = parseFrontmatterData(markdown)[namespace];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const defs: Record<string, PropertyDef> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const spec = value as Record<string, unknown>;
    if (typeof spec.type !== "string" || !PROPERTY_TYPES.includes(spec.type as PropertyType)) continue;
    defs[name] = {
      type: spec.type as PropertyType,
      label: typeof spec.label === "string" ? spec.label : undefined,
      options: Array.isArray(spec.options) ? spec.options.filter((o): o is string => typeof o === "string") : undefined,
      optionColors: readOptionColors(spec.optionColors),
    };
  }
  return defs;
}

/** 新建 frontmatter（无 frontmatter 时）：写入定义并保持最小结构。 */
export function createFrontmatter(markdown: string, namespace: string, def: PropertyDef, name: string): string {
  const initial: Record<string, unknown> = { [namespace]: { [name]: defNode(def) } };
  if (namespace === PROPS_KEY) initial[name] = emptyPropertyValue(def);
  const doc = new Document(initial);
  return `---\n${doc.toString().replace(/\n$/, "")}\n---\n\n${markdown}`;
}

function emptyPropertyValue(def: PropertyDef): string | boolean | string[] {
  if (def.type === "checkbox") return false;
  if (def.type === "multiselect") return [];
  if (def.type === "select") return def.options?.[0] ?? "";
  return "";
}

function defNode(def: PropertyDef): Record<string, unknown> {
  const spec: Record<string, unknown> = { type: def.type };
  if (def.label) spec.label = def.label;
  if (def.options) spec.options = def.options;
  if (def.optionColors && Object.keys(def.optionColors).length > 0) spec.optionColors = def.optionColors;
  return spec;
}

function readOptionColors(raw: unknown): Record<string, OptionColor> | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const colors = Object.fromEntries(Object.entries(raw as Record<string, unknown>)
    .filter((entry): entry is [string, OptionColor] => typeof entry[1] === "string" && OPTION_COLORS.includes(entry[1] as OptionColor)));
  return Object.keys(colors).length ? colors : undefined;
}

/** 在既有 frontmatter 中写入命名空间定义；无 frontmatter 时新建。 */
export function writeDef(markdown: string, namespace: string, name: string, def: PropertyDef): string {
  const { frontText, body } = splitFrontmatter(markdown);
  if (!frontText) return createFrontmatter(markdown, namespace, def, name);
  const doc = parseDocument(frontText.slice(4).replace(/\n---\s*$/, ""));
  const container = doc.get(namespace) as YAMLMap | undefined;
  if (container && typeof container.set === "function") {
    container.set(name, doc.createNode(defNode(def)));
  } else {
    doc.set(namespace, doc.createNode({ [name]: defNode(def) }));
  }
  if (namespace === PROPS_KEY && doc.get(name, true) === undefined) doc.set(name, doc.createNode(emptyPropertyValue(def)));
  return `---\n${String(doc).replace(/\n$/, "")}\n---\n\n${body}`;
}

/** 重命名命名空间内一个定义键（表格列重命名）；目标名已存在时不操作（调用方先行校验）。 */
export function renameDef(markdown: string, namespace: string, from: string, to: string): string {
  if (from === to) return markdown;
  const { frontText, body } = splitFrontmatter(markdown);
  if (!frontText) return markdown;
  const doc = parseDocument(frontText.slice(4).replace(/\n---\s*$/, ""));
  const container = doc.get(namespace) as YAMLMap | undefined;
  if (!container || typeof container.get !== "function") return markdown;
  const def = container.get(from);
  if (def === undefined) return markdown;
  container.delete(from);
  container.set(to, def);
  return `---\n${String(doc).replace(/\n$/, "")}\n---\n\n${body}`;
}

/** 重排命名空间内定义键；未列入 order 的定义保留在末尾且相对顺序不变。 */
export function reorderDefs(markdown: string, namespace: string, order: string[]): string {
  const { frontText, body } = splitFrontmatter(markdown);
  if (!frontText) return markdown;
  const doc = parseDocument(frontText.slice(4).replace(/\n---\s*$/, ""));
  const container = doc.get(namespace) as YAMLMap | undefined;
  if (!container || !Array.isArray(container.items)) return markdown;
  const rank = new Map(order.map((name, index) => [name, index]));
  const keyName = (pair: unknown): string => {
    const key = (pair as { key?: unknown }).key;
    return typeof key === "object" && key !== null && "value" in key
      ? String((key as { value: unknown }).value) : String(key ?? "");
  };
  container.items = [...container.items].sort((left, right) => {
    const leftKey = keyName(left);
    const rightKey = keyName(right);
    return (rank.get(leftKey) ?? Number.MAX_SAFE_INTEGER) - (rank.get(rightKey) ?? Number.MAX_SAFE_INTEGER);
  });
  return `---\n${String(doc).replace(/\n$/, "")}\n---\n\n${body}`;
}

/** 删除命名空间内一个定义键（表格删列）；不存在时原样返回。 */
export function removeDef(markdown: string, namespace: string, name: string): string {
  const { frontText, body } = splitFrontmatter(markdown);
  if (!frontText) return markdown;
  const doc = parseDocument(frontText.slice(4).replace(/\n---\s*$/, ""));
  const container = doc.get(namespace) as YAMLMap | undefined;
  if (!container || typeof container.delete !== "function") return markdown;
  if (container.get(name) === undefined) return markdown;
  container.delete(name);
  const serialized = String(doc).trimEnd();
  if (serialized.length === 0) return body;
  return `---\n${serialized}\n---\n\n${body}`;
}

/** 写入/更新一个数据键：有 YAML 节点则原位替换值，未触碰键保持原样。无 frontmatter 时新建。 */
export function writeValue(markdown: string, key: string, value: string | boolean | string[] | number | null): string {
  const { frontText, body } = splitFrontmatter(markdown);
  if (!frontText) {
    const doc = new Document({ [key]: value });
    return `---\n${doc.toString().replace(/\n$/, "")}\n---\n\n${markdown}`;
  }
  const doc = parseDocument(frontText.slice(4).replace(/\n---\s*$/, ""));
  const existing = doc.get(key, true) as { value?: unknown } | undefined;
  if (value === null || value === "") {
    if (existing !== undefined) doc.delete(key);
  } else if (existing === undefined || existing.value === undefined) {
    doc.set(key, doc.createNode(value));
  } else {
    existing.value = value;
  }
  const serialized = String(doc).trimEnd();
  if (serialized.length === 0) return body;
  return `---\n${serialized}\n---\n\n${body}`;
}

/** 展示用键值对（含类型推断信息）；解析失败或非标量键在 UI 降级为文本。 */
export interface PropRow {
  key: string;
  raw: string;
  isBoolean: boolean;
  isArray: boolean;
  arrayValues: string[];
  def?: PropertyDef;
}

export function readPropRows(markdown: string, namespace: string): PropRow[] {
  const data = parseFrontmatterData(markdown);
  const defs = readDefs(markdown, namespace);
  const rows = Object.entries(data)
    .filter(([key]) => key !== PROPS_KEY && key !== FIELDS_KEY)
    .map(([key, value]) => ({
      key,
      raw: typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "",
      isBoolean: typeof value === "boolean",
      isArray: Array.isArray(value) && value.every((entry) => typeof entry === "string"),
      arrayValues: Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [],
      def: defs[key],
    }));
  // 只有定义没有值的属性（如从默认属性预设加进来的空属性）也要列出来，否则加了却看不见。
  for (const [key, def] of Object.entries(defs)) {
    if (rows.some((row) => row.key === key)) continue;
    rows.push({ key, raw: "", isBoolean: false, isArray: false, arrayValues: [], def });
  }
  return rows;
}

/** 删除一个数据键（用户明确操作）。 */
export function removeProp(markdown: string, key: string): string {
  return writeValue(markdown, key, null);
}

/** 删除一个属性：连同它的定义一起去掉（只删值会留下看不见的定义残渣）。 */
export function removePropDef(markdown: string, namespace: string, key: string): string {
  return removeDef(removeProp(markdown, key), namespace, key);
}

/**
 * 重命名属性键（FR-PROP-2 属性设置浮层）：**定义与值一起迁移**。
 * 分开做会留下「有值没定义」或「有定义没值」的半截状态，所以这里按
 * 写新值 → 删旧值 → 迁定义三步走；目标键已存在或源键不存在时原样返回（调用方先行校验并提示）。
 */
export function renameProp(markdown: string, namespace: string, from: string, to: string): string {
  if (from === to) return markdown;
  const row = readPropRows(markdown, namespace).find((entry) => entry.key === from);
  if (!row) return markdown;
  if (readPropRows(markdown, namespace).some((entry) => entry.key === to)) return markdown;
  const value = row.isBoolean ? row.raw === "true"
    : row.isArray ? row.arrayValues
      : row.raw;
  const withValue = value === "" ? markdown : writeValue(markdown, to, value);
  return renameDef(removeProp(withValue, from), namespace, from, to);
}

/** 确认保存的 AI 概述（FR-AI-1）：数据键 `summary`，属性区显示名「概述」。先写值再补定义，避免定义写入把已有值清成空串。 */
export function writeSummaryProperty(markdown: string, summary: string): string {
  const withValue = writeValue(markdown, "summary", summary);
  return writeDef(withValue, PROPS_KEY, "summary", { type: "multiline", label: "概述" });
}
