/**
 * 文档渲染样式偏好（FR-STYLE-2）：只覆盖 `--md-*` 变量，不动外壳配色。
 *
 * 存放形式刻意定成「CSS 变量名 → 值」的扁平表：`index.html` 的引导脚本可以直接
 * 逐个 setProperty，不用在前端与引导脚本里各写一份映射（两份映射迟早对不上）。
 * 全局一套，随本机偏好保存；清空即回落到 tokens.css 的默认值。
 */

export type DocStyleVars = Record<string, string>;

const STORAGE_KEY = "menote.docStyle";
/** 只接受自定义属性名，避免把任意 style 塞进根节点。 */
const VAR_PATTERN = /^--md-[a-z0-9-]+$/;

/** 默认值 = tokens.css 当前取值，仅用于面板回显与「恢复默认」。 */
export const DOC_STYLE_DEFAULTS: DocStyleVars = {
  "--md-body-size": "0.875rem",
  "--md-body-leading": "1.78",
  "--md-body-weight": "400",
  "--md-h1-size": "2rem",
  "--md-h1-weight": "500",
  "--md-h1-color": "var(--app-fg)",
  "--md-h2-size": "0.875rem",
  "--md-h2-weight": "600",
  "--md-h2-color": "var(--app-fg)",
  "--md-h3-size": "0.875rem",
  "--md-h3-weight": "600",
  "--md-h3-color": "var(--app-fg)",
  "--md-strong-size": "1em",
  "--md-strong-weight": "600",
  "--md-strong-color": "var(--app-fg)",
  "--md-strong-rule": "none",
  "--md-h1-rule": "none",
  "--md-h2-rule": "none",
  "--md-h3-rule": "none",
  "--md-h1-rule-pad": "var(--app-zero)",
  "--md-h2-rule-pad": "var(--app-zero)",
  "--md-h3-rule-pad": "var(--app-zero)",
  "--md-heading-rule-width": "2px",
  "--md-heading-rule-color": "var(--app-accent)",
  "--md-heading-rule-gap": "0.25rem",
  "--md-heading-rule-extra": "0.75rem",
  "--md-heading-rule-opacity": "1",
};

/** 已写进根节点的变量，恢复默认时按这份清单逐个移除，避免残留。 */
const applied = new Set<string>();

export function getDocStyle(): DocStyleVars {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  const result: DocStyleVars = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!VAR_PATTERN.test(key) || typeof value !== "string" || !value.trim()) continue;
    // 兼容首版：装饰线当时用 border-style 开关，存的是 solid；现在驱动伪元素 display
    result[key] = /^--md-h[123]-rule$/.test(key) && value === "solid" ? "block" : value;
  }
  return result;
}

/** 把变量写到 `:root`；先清上一次写入的，再写当前值，切档不会留残影。 */
export function applyDocStyle(vars: DocStyleVars = getDocStyle()): void {
  const root = document.documentElement;
  for (const key of applied) root.style.removeProperty(key);
  applied.clear();
  for (const [key, value] of Object.entries(vars)) {
    if (!VAR_PATTERN.test(key)) continue;
    root.style.setProperty(key, value);
    applied.add(key);
  }
}

/** 合并写入并立即生效。 */
export function updateDocStyle(patch: DocStyleVars): DocStyleVars {
  const next = { ...getDocStyle(), ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch { /* 隐私模式写不进去时仍然即时生效，只是不持久。 */ }
  applyDocStyle(next);
  return next;
}

/** 恢复默认：清空偏好并摘掉根节点上的覆盖。 */
export function resetDocStyle(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* 同上 */ }
  applyDocStyle({});
}

/** 面板回显用：默认值兜底。 */
export function effectiveDocStyle(): DocStyleVars {
  return { ...DOC_STYLE_DEFAULTS, ...getDocStyle() };
}
