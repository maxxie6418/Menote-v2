/** 正文文字色白名单：Menote 只渲染这七种内联颜色，其余颜色一律降级为普通文字（FR-EDT-15）。
 *  解析器（如 Flomo 导入）把外来颜色映射到最接近的白名单颜色，避免外来样式破坏正文。 */

export const MEMO_TEXT_COLORS = [
  "#c2412d", "#b45309", "#8a6d00", "#287044", "#2459a6", "#7046a6", "#6c6f6b",
] as const;

export const ALLOWED_MEMO_COLORS = new Set<string>(MEMO_TEXT_COLORS);

/** 十六进制颜色（#rgb / #rrggbb）转 RGB 分量；不认得的写法返回 null。 */
export function parseHexColor(value: string): [number, number, number] | null {
  const hex = value.trim().replace(/^#/, "");
  if (hex.length === 3 && /^[0-9a-f]{3}$/i.test(hex)) {
    return [parseInt(hex[0]! + hex[0]!, 16), parseInt(hex[1]! + hex[1]!, 16), parseInt(hex[2]! + hex[2]!, 16)];
  }
  if (hex.length === 6 && /^[0-9a-f]{6}$/i.test(hex)) {
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  return null;
}

/** 外来颜色映射到白名单里最接近的一种；无法识别时返回 null（调用方按普通文字处理）。 */
export function nearestMemoColor(value: string): string | null {
  const rgb = parseHexColor(value);
  if (!rgb) return null;
  let best = MEMO_TEXT_COLORS[0] as string;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of MEMO_TEXT_COLORS) {
    const target = parseHexColor(candidate)!;
    const distance =
      (rgb[0] - target[0]) ** 2 + (rgb[1] - target[1]) ** 2 + (rgb[2] - target[2]) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}
