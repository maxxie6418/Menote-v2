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
  return spec;
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
  return Object.entries(data)
    .filter(([key]) => key !== PROPS_KEY && key !== FIELDS_KEY)
    .map(([key, value]) => ({
      key,
      raw: typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "",
      isBoolean: typeof value === "boolean",
      isArray: Array.isArray(value) && value.every((entry) => typeof entry === "string"),
      arrayValues: Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [],
      def: defs[key],
    }));
}

/** 删除一个数据键（用户明确操作）。 */
export function removeProp(markdown: string, key: string): string {
  return writeValue(markdown, key, null);
}

/** 确认保存的 AI 概述（FR-AI-1）：数据键 `summary`，属性区显示名「概述」。先写值再补定义，避免定义写入把已有值清成空串。 */
export function writeSummaryProperty(markdown: string, summary: string): string {
  const withValue = writeValue(markdown, "summary", summary);
  return writeDef(withValue, PROPS_KEY, "summary", { type: "multiline", label: "概述" });
}
