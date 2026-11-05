/** 从剪藏正文的 frontmatter 取出原网页。只认 http(s)，不改正文。 */

export interface ClipSource {
  url: string;
  host: string;
}

export function clipSourceFromMarkdown(markdown: string): ClipSource | null {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!front) return null;
  const line = /^source_url:\s*(.+)$/m.exec(front[1]);
  if (!line) return null;
  let raw = line[1].trim();
  if (raw.startsWith('"') || raw.startsWith("'")) {
    try { raw = JSON.parse(raw.replace(/^'/, '"').replace(/'$/, '"')); } catch { return null; }
  }
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return { url: url.href, host: url.host };
  } catch {
    return null;
  }
}
