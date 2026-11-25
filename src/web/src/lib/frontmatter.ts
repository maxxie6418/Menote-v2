import { Document, isNode, isScalar, parse as parseYaml, parseDocument, stringify, YAMLMap } from "yaml";

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
  | "text" | "multiline" | "number" | "date" | "datetime" | "list" | "select" | "multiselect" | "checkbox" | "link" | "attachment";

export type PropertyScalar = string | boolean | number | null;
export type PropertyValue = PropertyScalar | PropertyScalar[];

export const PROPERTY_TYPES: readonly PropertyType[] =
  ["text", "multiline", "number", "date", "datetime", "list", "select", "multiselect", "checkbox", "link"];

/** 表格侧不提供多行文本（FR-PROP-4）。 */
export const TABLE_FIELD_TYPES: readonly PropertyType[] =
  ["text", "number", "date", "select", "multiselect", "checkbox", "link", "attachment"];

export interface PropertyDef {
  type: PropertyType;
  label?: string;
  options?: string[];
  optionColors?: Record<string, OptionColor>;
  /**
   * 属性区位置（2026-11-12）：true 强制进第一排、false 强制不进；缺省时按类型与预设判定。
   * 显式写在 props 定义里，随文档走，不吃「值有多长」的推断。
   */
  strip?: boolean;
  /** true 表示独享整排（文本类还会按两行显示），用于概述这类要读全的字段。 */
  wide?: boolean;
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
  /** 进属性区第一排（与 PropertyDef.strip 同义）；缺省按类型判定。 */
  strip?: boolean;
  /** 独享整排并两行显示（与 PropertyDef.wide 同义），用于概述这类要读全的字段。 */
  wide?: boolean;
}

/** Note 页边注存入同一条目 frontmatter，随正文版本、同步、加密与备份一并流转。 */
export interface NoteMarginalia {
  id: string;
  quote: string;
  note: string;
  createdAt: number;
}

const MARGINALIA_KEY = "menote_marginalia";

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
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(markdown);
  if (!opening) return { frontText: null, body: markdown };
  const fence = /^---[ \t]*(?=\r?$)/gm;
  fence.lastIndex = opening[0].length;
  const closing = fence.exec(markdown);
  if (!closing) return { frontText: null, body: markdown };
  const end = closing.index + closing[0].length;
  const frontText = markdown.slice(0, end);
  // 闭合围栏后的分隔空行在这里剥净：join 侧恒补一个空行，两侧互逆，
  // 往返（页边注/属性写入 → 保存）不再逐次给正文累积空行。
  return { frontText, body: markdown.slice(end).replace(/^(?:\r?\n)+/, "") };
}

/** 把编辑器里的纯正文拼回属性区管理的 frontmatter（FR-PROP-1）。无属性时原样返回正文。 */
export function joinFrontmatter(frontText: string | null, body: string): string {
  if (!frontText) return body;
  const newline = frontText.includes("\r\n") ? "\r\n" : "\n";
  return `${frontText}${newline}${newline}${body}`;
}

export function replaceMarkdownBody(markdown: string, body: string): string {
  const { frontText, body: previous } = splitFrontmatter(markdown);
  if (previous === body) return markdown;
  if (!frontText) return body;
  const separator = /^(?:\r?\n)+/.exec(markdown.slice(frontText.length))?.[0];
  return separator ? frontText + separator + body : joinFrontmatter(frontText, body);
}

function frontmatterYaml(frontText: string): string {
  return frontText.slice(frontText.indexOf("\n") + 1, frontText.lastIndexOf("\n") + 1);
}

function updateFrontmatter(markdown: string, frontText: string, doc: Document): string {
  const serialized = String(doc).trimEnd();
  const newline = frontText.includes("\r\n") ? "\r\n" : "\n";
  const closing = frontText.slice(frontText.lastIndexOf("\n") + 1);
  const suffix = markdown.slice(frontText.length);
  if (!serialized || serialized === "{}") return suffix.replace(/^(?:\r?\n)+/, "");
  return `${frontText.slice(0, frontText.indexOf("\n") + 1)}${serialized.replace(/\n/g, newline)}${newline}${closing}${suffix}`;
}

/** 解析 frontmatter 数据面；空/损坏 frontmatter 视为无属性（不抛出，C-1 不阻断）。 */
export function parseFrontmatterData(markdown: string): Record<string, unknown> {
  return tryParseFrontmatterData(markdown) ?? {};
}

export function tryParseFrontmatterData(markdown: string): Record<string, unknown> | null {
  const { frontText } = splitFrontmatter(markdown);
  if (!frontText) return {};
  try {
    const data = parseYaml(frontmatterYaml(frontText));
    if (data === null || data === undefined) return {};
    return typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** 读取并校验 Note 页边注；损坏/未知条目忽略，不把 YAML 值直接信任为 UI 数据。 */
export function readNoteMarginalia(markdown: string): NoteMarginalia[] {
  const raw = parseFrontmatterData(markdown)[MARGINALIA_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value): NoteMarginalia[] => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.quote !== "string" || typeof row.note !== "string"
      || typeof row.createdAt !== "number" || !Number.isFinite(row.createdAt)) return [];
    return [{ id: row.id, quote: row.quote.slice(0, 4_000), note: row.note.slice(0, 4_000), createdAt: row.createdAt }];
  }).slice(-500);
}

/** 更新只属于 Menote 的 frontmatter 键；其它属性、表格字段、注释和正文原样保留。 */
export function writeNoteMarginalia(markdown: string, annotations: NoteMarginalia[]): string {
  const { frontText, body } = splitFrontmatter(markdown);
  const document = frontText
    ? parseDocument(frontmatterYaml(frontText))
    : new Document({});
  if (document.errors.length > 0) throw new Error("invalid_frontmatter");
  // 标量/数组形式的 frontmatter 无法在保留原文的前提下扩展映射键：
  // 读取路径视为无属性，写入路径按契约显式报错（而不是抛 YAML 内部异常）。
  if (frontText && document.contents !== null && !(document.contents instanceof YAMLMap)) {
    if (annotations.length === 0) return markdown;
    throw new Error("invalid_frontmatter");
  }
  const value = annotations.slice(-500).map(({ id, quote, note, createdAt }) => ({
    id: id.slice(0, 128), quote: quote.slice(0, 4_000), note: note.slice(0, 4_000), createdAt,
  }));
  if (!frontText && value.length === 0) return markdown;
  if (value.length > 0) document.set(MARGINALIA_KEY, document.createNode(value));
  else document.delete(MARGINALIA_KEY);
  const serialized = String(document).trimEnd();
  // 删空后序列化会残留空映射 "{}"：视同无属性，直接还原正文。
  return serialized.length > 0 && serialized !== "{}" ? `---\n${serialized}\n---\n\n${body}` : body;
}

export function readDefs(markdown: string, namespace: string): Record<string, PropertyDef> {
  const raw = parseFrontmatterData(markdown)[namespace];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const allowedTypes = namespace === FIELDS_KEY ? TABLE_FIELD_TYPES : PROPERTY_TYPES;
  const defs: Record<string, PropertyDef> = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const spec = value as Record<string, unknown>;
    if (typeof spec.type !== "string" || !allowedTypes.includes(spec.type as PropertyType)) continue;
    defs[name] = {
      type: spec.type as PropertyType,
      label: typeof spec.label === "string" ? spec.label : undefined,
      options: Array.isArray(spec.options) ? spec.options.filter((o): o is string => typeof o === "string") : undefined,
      optionColors: readOptionColors(spec.optionColors),
      ...(typeof spec.strip === "boolean" ? { strip: spec.strip } : {}),
      ...(typeof spec.wide === "boolean" ? { wide: spec.wide } : {}),
    };
  }
  return defs;
}

/** 系统保留键：用户属性不得占用（页边注数据键与两个命名空间）。 */
const RESERVED_KEYS = new Set([PROPS_KEY, FIELDS_KEY, MARGINALIA_KEY]);

/** 新建 frontmatter（无 frontmatter 时）：写入定义并保持最小结构。 */
export function createFrontmatter(markdown: string, namespace: string, def: PropertyDef, name: string): string {
  // 保留键/与命名空间同名会让顶层结构互相覆盖，按「目标已存在不操作」契约原样返回。
  if (name === namespace || RESERVED_KEYS.has(name)) return markdown;
  const initial: Record<string, unknown> = { [namespace]: { [name]: defNode(def) } };
  if (namespace === PROPS_KEY) initial[name] = emptyPropertyValue(def);
  const doc = new Document(initial);
  return `---\n${doc.toString().replace(/\n$/, "")}\n---\n\n${markdown}`;
}

function emptyPropertyValue(def: PropertyDef): string | boolean | string[] {
  if (def.type === "checkbox") return false;
  if (def.type === "list" || def.type === "multiselect") return [];
  if (def.type === "select") return def.options?.[0] ?? "";
  return "";
}

function defNode(def: PropertyDef): Record<string, unknown> {
  const spec: Record<string, unknown> = { type: def.type };
  if (def.label) spec.label = def.label;
  if (def.options) spec.options = def.options;
  if (def.optionColors && Object.keys(def.optionColors).length > 0) spec.optionColors = def.optionColors;
  if (typeof def.strip === "boolean") spec.strip = def.strip;
  if (typeof def.wide === "boolean") spec.wide = def.wide;
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
  if (name === namespace || RESERVED_KEYS.has(name)) return markdown;
  const { frontText } = splitFrontmatter(markdown);
  if (!frontText) return createFrontmatter(markdown, namespace, def, name);
  const doc = parseDocument(frontmatterYaml(frontText));
  const container = doc.get(namespace) as YAMLMap | undefined;
  if (container && typeof container.set === "function") {
    container.set(name, doc.createNode(defNode(def)));
  } else {
    doc.set(namespace, doc.createNode({ [name]: defNode(def) }));
  }
  if (namespace === PROPS_KEY && doc.get(name, true) === undefined) doc.set(name, doc.createNode(emptyPropertyValue(def)));
  return updateFrontmatter(markdown, frontText, doc);
}

/** 重命名命名空间内一个定义键（表格列重命名）；目标名已存在时不操作（调用方先行校验）。 */
export function renameDef(markdown: string, namespace: string, from: string, to: string): string {
  if (from === to) return markdown;
  const { frontText } = splitFrontmatter(markdown);
  if (!frontText) return markdown;
  const doc = parseDocument(frontmatterYaml(frontText));
  const container = doc.get(namespace) as YAMLMap | undefined;
  if (!container || typeof container.get !== "function") return markdown;
  const def = container.get(from);
  if (def === undefined) return markdown;
  container.delete(from);
  container.set(to, def);
  return updateFrontmatter(markdown, frontText, doc);
}

/** 重排命名空间内定义键；未列入 order 的定义保留在末尾且相对顺序不变。 */
export function reorderDefs(markdown: string, namespace: string, order: string[]): string {
  const { frontText } = splitFrontmatter(markdown);
  if (!frontText) return markdown;
  const doc = parseDocument(frontmatterYaml(frontText));
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
  return updateFrontmatter(markdown, frontText, doc);
}

/** 删除命名空间内一个定义键（表格删列）；不存在时原样返回。 */
export function removeDef(markdown: string, namespace: string, name: string): string {
  const { frontText } = splitFrontmatter(markdown);
  if (!frontText) return markdown;
  const doc = parseDocument(frontmatterYaml(frontText));
  const container = doc.get(namespace) as YAMLMap | undefined;
  if (!container || typeof container.delete !== "function") return markdown;
  if (container.get(name) === undefined) return markdown;
  container.delete(name);
  return updateFrontmatter(markdown, frontText, doc);
}

/** 写入/更新一个数据键：有 YAML 节点则原位替换值，未触碰键保持原样。无 frontmatter 时新建。 */
export function writeValue(markdown: string, key: string, value: PropertyValue): string {
  const { frontText } = splitFrontmatter(markdown);
  if (!frontText) {
    if (value === null || value === "") return markdown;
    const doc = new Document({ [key]: value });
    return `---\n${doc.toString().replace(/\n$/, "")}\n---\n\n${markdown}`;
  }
  const doc = parseDocument(frontmatterYaml(frontText));
  if (doc.errors.length > 0 || (doc.contents !== null && !(doc.contents instanceof YAMLMap))) throw new Error("invalid_frontmatter");
  const existing = doc.get(key, true);
  if (value === null || value === "") {
    if (!doc.delete(key)) return markdown;
  } else if (isScalar(existing) && !Array.isArray(value)) {
    existing.value = value;
  } else {
    const node = doc.createNode(value);
    if (isNode(existing)) {
      node.comment = existing.comment;
      node.commentBefore = existing.commentBefore;
      node.spaceBefore = existing.spaceBefore;
    }
    doc.set(key, node);
  }
  return updateFrontmatter(markdown, frontText, doc);
}

/** 展示用键值对（含类型推断信息）；解析失败或非标量键在 UI 降级为文本。 */
export interface PropRow {
  key: string;
  raw: string;
  isBoolean: boolean;
  isNumber?: boolean;
  isStructured?: boolean;
  isArray: boolean;
  arrayValues: string[];
  listValues?: PropertyScalar[];
  def?: PropertyDef;
}

export function readPropRows(markdown: string, namespace: string): PropRow[] {
  const data = parseFrontmatterData(markdown);
  const defs = readDefs(markdown, namespace);
  const rows: PropRow[] = Object.entries(data)
    .filter(([key]) => key !== PROPS_KEY && key !== FIELDS_KEY && key !== MARGINALIA_KEY)
    .map(([key, value]) => ({
      key,
      raw: typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value)
        : value == null ? "" : stringify(value).trimEnd(),
      isBoolean: typeof value === "boolean",
      isNumber: typeof value === "number",
      isStructured: value !== null && typeof value === "object" && !(Array.isArray(value) && value.every(isPropertyScalar)),
      isArray: Array.isArray(value) && value.every((entry) => typeof entry === "string"),
      arrayValues: Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [],
      listValues: Array.isArray(value) && value.every(isPropertyScalar) ? value as PropertyScalar[] : undefined,
      def: defs[key],
    }));
  // 只有定义没有值的属性（如从默认属性预设加进来的空属性）也要列出来，否则加了却看不见。
  for (const [key, def] of Object.entries(defs)) {
    if (rows.some((row) => row.key === key)) continue;
    rows.push({ key, raw: "", isBoolean: false, isArray: false, arrayValues: [], listValues: undefined, def });
  }
  return rows;
}

function isPropertyScalar(value: unknown): value is PropertyScalar {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

export function parsePropertyList(text: string): PropertyScalar[] | null {
  if (!text.trim()) return [];
  try {
    const value: unknown = parseYaml(text);
    return Array.isArray(value) && value.every(isPropertyScalar) ? value : null;
  } catch { return null; }
}

/** 删除一个数据键（用户明确操作）。 */
export function removeProp(markdown: string, key: string): string {
  return writeValue(markdown, key, null);
}

/** 删除一个属性：连同它的定义一起去掉（只删值会留下看不见的定义残渣）。 */
export function removePropDef(markdown: string, namespace: string, key: string): string {
  return removeDef(removeProp(markdown, key), namespace, key);
}

/** Undo property deletion by merging only its prior value/definition into the latest document. */
export function restoreProp(markdown: string, previousMarkdown: string, namespace: string, key: string): string {
  const { frontText } = splitFrontmatter(markdown);
  const previous = splitFrontmatter(previousMarkdown).frontText;
  if (!previous || Object.hasOwn(readDefs(markdown, namespace), key)) return markdown;
  const doc = frontText ? parseDocument(frontmatterYaml(frontText)) : new Document({});
  if (doc.errors.length || doc.has(key)) return markdown;
  const old = parseDocument(frontmatterYaml(previous));
  const pair = old.contents instanceof YAMLMap ? old.contents.items.find((item) => isScalar(item.key) && item.key.value === key) : undefined;
  if (pair && doc.contents instanceof YAMLMap) doc.contents.items.push(pair);
  const next = frontText ? updateFrontmatter(markdown, frontText, doc)
    : pair ? joinFrontmatter(`---\n${String(doc).trimEnd()}\n---`, markdown) : markdown;
  const def = readDefs(previousMarkdown, namespace)[key];
  return def ? writeDef(next, namespace, key, def) : next;
}

/**
 * 重命名属性键（FR-PROP-2 属性设置浮层）：**定义与值一起迁移**。
 * 重命名键节点，保留原值及注释；目标已存在时原样返回。
 */
export function renameProp(markdown: string, namespace: string, from: string, to: string): string {
  if (from === to || RESERVED_KEYS.has(to)) return markdown;
  const { frontText } = splitFrontmatter(markdown);
  if (!frontText || Object.hasOwn(readDefs(markdown, namespace), to)) return markdown;
  const doc = parseDocument(frontmatterYaml(frontText));
  if (doc.errors.length || doc.has(to) || !(doc.contents instanceof YAMLMap)) return markdown;
  const pair = doc.contents.items.find((item) => isScalar(item.key) && item.key.value === from);
  if (pair && isScalar(pair.key)) pair.key.value = to;
  return renameDef(pair ? updateFrontmatter(markdown, frontText, doc) : markdown, namespace, from, to);
}

/** 确认保存的 AI 概述（FR-AI-1）：数据键 `summary`，属性区显示名「概述」。先写值再补定义，避免定义写入把已有值清成空串。 */
export function writeSummaryProperty(markdown: string, summary: string): string {
  const withValue = writeValue(markdown, "summary", summary);
  return writeDef(withValue, PROPS_KEY, "summary", { type: "multiline", label: "概述" });
}
