export interface ClipTemplateField {
  selector: string;
  value: "text" | "html" | "attribute";
  attribute?: "datetime" | "content" | "href" | "src" | "alt";
}

/** Declarative and data-only clipping rule shared by Menote and its browser extension. */
export interface ClipTemplateV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  enabled: boolean;
  match: { hosts: string[]; paths: string[] };
  selectors: {
    title: ClipTemplateField;
    content: ClipTemplateField;
    author?: ClipTemplateField;
    publishedAt?: ClipTemplateField;
  };
  exclude: string[];
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

export function isClipTemplateV1(value: unknown): value is ClipTemplateV1 {
  if (!value || typeof value !== "object") return false;
  const template = value as Record<string, unknown>;
  if (JSON.stringify(value).length > 48 * 1024 || template.schemaVersion !== 1 || typeof template.id !== "string" || template.id.length > 80 ||
      typeof template.name !== "string" || !template.name.trim() || template.name.length > 120 || typeof template.enabled !== "boolean") return false;
  if (!template.match || typeof template.match !== "object" || !template.selectors || typeof template.selectors !== "object") return false;
  const match = template.match as Record<string, unknown>;
  const selectors = template.selectors as Record<string, unknown>;
  if (!Array.isArray(match.hosts) || match.hosts.length < 1 || match.hosts.length > 16 ||
      !match.hosts.every((host) => typeof host === "string" && HOST.test(host)) ||
      !Array.isArray(match.paths) || match.paths.length > 32 ||
      !match.paths.every((path) => typeof path === "string" && path.startsWith("/") && path.length <= 256 && !/[?#[\]{}()+\\]/.test(path)) ||
      !validField(selectors.title) || !validField(selectors.content) || !validField(selectors.author, true) || !validField(selectors.publishedAt, true) ||
      !Array.isArray(template.exclude) || template.exclude.length > 32 ||
      !template.exclude.every((selector) => typeof selector === "string" && selector.length <= 512 && validField({ selector, value: "text" }))) return false;
  if (template.source !== undefined && (!template.source || typeof template.source !== "object" ||
      !["edgeever", "visual", "manual"].includes(String((template.source as Record<string, unknown>).kind)))) return false;
  return true;
}
