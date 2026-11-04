const COLOR_OPEN = /^<span style="color:#[0-9a-f]{6}">/i;
const COLOR_CLOSE = /<\/span>$/i;

/** Wrap selected Markdown text in a portable inline HTML color span. */
export function applyTextColor(markdown: string, start: number, end: number, color: string | null): { markdown: string; start: number; end: number } | null {
  if (start < 0 || end <= start || end > markdown.length) return null;
  const before = markdown.slice(0, start);
  const selected = markdown.slice(start, end);
  const after = markdown.slice(end);
  const open = before.match(/<span style="color:#[0-9a-f]{6}">$/i)?.[0];
  const close = after.match(/^<\/span>/i)?.[0];
  if (open && close) {
    const current = open.match(/#[0-9a-f]{6}/i)?.[0].toLowerCase();
    const unwrapped = before.slice(0, -open.length) + selected + after.slice(close.length);
    if (!color || current === color.toLowerCase()) return { markdown: unwrapped, start, end };
    const prefix = `<span style="color:${color}">`;
    const wrapped = `${prefix}${selected}</span>`;
    return { markdown: before.slice(0, -open.length) + wrapped + after.slice(close.length), start: start + prefix.length - open.length, end: end + prefix.length - open.length };
  }
  const prefix = color ? `<span style="color:${color}">` : "";
  const wrapped = color ? `${prefix}${selected}</span>` : selected;
  return { markdown: before + wrapped + after, start: start + prefix.length, end: start + prefix.length + selected.length };
}

export const DEFAULT_TEXT_COLORS = [
  { id: "red", label: "红色" },
  { id: "orange", label: "橙色" },
  { id: "yellow", label: "金色" },
  { id: "green", label: "绿色" },
  { id: "blue", label: "蓝色" },
  { id: "purple", label: "紫色" },
  { id: "gray", label: "灰色" },
] as const;

export function colorValueFromCss(value: string): string | null {
  const match = value.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (!match) return null;
  return `#${match.slice(1).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
}
