/** 只放行 http/https：单元格与详情里的链接都指向外部地址，`javascript:` 一律不渲染成 <a>。 */
export function safeWebUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
