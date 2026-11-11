export interface ClipTemplateField {
  selector: string;
  value: "text" | "html" | "attribute";
  attribute?: "datetime" | "content" | "href" | "src" | "alt";
}

/** 命令式管线（capture + clip）适配器的注册信息；实现随扩展发行，应用侧只存元数据与启停。 */
export interface CaptureAdapterInfo {
  id: string;
  version: string;
  upstream?: string;
}

export type ClipPipeline = "template" | "capture-clip";

/**
 * Declarative and data-only clipping rule shared by Menote and its browser extension.
 * `pipeline` 缺省为 "template"（声明式，selectors 必填）；
 * `pipeline: "capture-clip"` 为命令式适配器注册条目（adapter 必填、无 selectors）。
 */
export interface ClipTemplateV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  enabled: boolean;
  pipeline?: ClipPipeline;
  match: { hosts: string[]; paths: string[] };
  selectors?: {
    title: ClipTemplateField;
    content: ClipTemplateField;
    author?: ClipTemplateField;
    publishedAt?: ClipTemplateField;
  };
  exclude: string[];
  adapter?: CaptureAdapterInfo;
  source?: { kind: "edgeever" | "visual" | "manual"; repository?: string; commit?: string; path?: string; license?: string };
}

export interface StoredClipTemplate {
  template: ClipTemplateV1;
  version: number;
  createdAt: number;
  updatedAt: number;
}

const ATTRIBUTES = new Set(["datetime", "content", "href", "src", "alt"]);
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;
const ADAPTER_ID = /^[A-Za-z0-9:_-]{1,80}$/;

function validField(value: unknown, optional = false): value is ClipTemplateField | undefined {
  if (optional && value === undefined) return true;
  if (!value || typeof value !== "object") return false;
  const field = value as Record<string, unknown>;
  if (typeof field.selector !== "string" || !field.selector.trim() || field.selector.length > 512) return false;
  if (!validSelectorSyntax(field.selector)) return false;
  if (field.value === "text" || field.value === "html") return field.attribute === undefined;
  return field.value === "attribute" && typeof field.attribute === "string" && ATTRIBUTES.has(field.attribute);
}

function validSelectorSyntax(selector: string): boolean {
  const stack: string[] = [];
  let quote = "";
  let escaped = false;
  for (const char of selector) {
    if (escaped) { escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (quote) { if (char === quote) quote = ""; continue; }
    if (char === "\"" || char === "'") { quote = char; continue; }
    if (char === "[" || char === "(") stack.push(char);
    if (char === "]" || char === ")") {
      const open = stack.pop();
      if ((char === "]" && open !== "[") || (char === ")" && open !== "(")) return false;
    }
  }
  return !quote && !escaped && stack.length === 0;
}

function validMatch(match: unknown): boolean {
  if (!match || typeof match !== "object") return false;
  const value = match as Record<string, unknown>;
  return Array.isArray(value.hosts) && value.hosts.length >= 1 && value.hosts.length <= 16
    && value.hosts.every((host) => typeof host === "string" && HOST.test(host))
    && Array.isArray(value.paths) && value.paths.length <= 32
    && value.paths.every((path) => typeof path === "string" && path.startsWith("/") && path.length <= 256 && !/[?#[\]{}()+\\]/.test(path));
}

function validAdapter(adapter: unknown): adapter is CaptureAdapterInfo {
  if (!adapter || typeof adapter !== "object") return false;
  const value = adapter as Record<string, unknown>;
  return typeof value.id === "string" && ADAPTER_ID.test(value.id)
    && typeof value.version === "string" && value.version.length >= 1 && value.version.length <= 24
    && (value.upstream === undefined || (typeof value.upstream === "string" && value.upstream.length <= 120));
}

function validExclude(exclude: unknown): boolean {
  return Array.isArray(exclude) && exclude.length <= 32
    && exclude.every((selector) => typeof selector === "string" && selector.length <= 512 && validField({ selector, value: "text" }));
}

export function isClipTemplateV1(value: unknown): value is ClipTemplateV1 {
  if (!value || typeof value !== "object") return false;
  const template = value as Record<string, unknown>;
  if (JSON.stringify(value).length > 48 * 1024 || template.schemaVersion !== 1 || typeof template.id !== "string" || template.id.length > 80 ||
      typeof template.name !== "string" || !template.name.trim() || template.name.length > 120 || typeof template.enabled !== "boolean") return false;
  if (!validMatch(template.match) || !validExclude(template.exclude)) return false;
  const pipeline = template.pipeline ?? "template";
  if (pipeline !== "template" && pipeline !== "capture-clip") return false;
  if (template.source !== undefined && (!template.source || typeof template.source !== "object" ||
      !["edgeever", "visual", "manual"].includes(String((template.source as Record<string, unknown>).kind)))) return false;
  if (pipeline === "capture-clip") {
    return validAdapter(template.adapter);
  }
  if (template.adapter !== undefined) return false;
  const selectors = template.selectors;
  if (!selectors || typeof selectors !== "object") return false;
  const fields = selectors as Record<string, unknown>;
  return validField(fields.title) && validField(fields.content) && validField(fields.author, true) && validField(fields.publishedAt, true);
}
