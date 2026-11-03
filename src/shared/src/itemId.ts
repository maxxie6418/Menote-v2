const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT = /^[A-Za-z0-9_-]{22}$/;

/** 22 位 base64url 短 ID 还原成 UUID。与前端 `/n/` 路由同一套编码。 */
function decodeShortItemId(token: string): string | null {
  if (!SHORT.test(token)) return null;
  try {
    const binary = atob(`${token.replace(/-/g, "+").replace(/_/g, "/")}==`);
    if (binary.length !== 16) return null;
    const hex = Array.from(binary, (char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    return null;
  }
}

/**
 * 绑定目标：完整 UUID、`/n/<短 ID>` 链接，或裸的 22 位短 ID。
 * 认不出来时原样返回，避免把任意 22 个字符从长链接里抠出来当 ID。
 */
export function resolveItemId(raw: string): string {
  const trimmed = raw.trim();
  if (UUID.test(trimmed)) return trimmed;
  const fromPath = /(?:^|[/?#])n\/([A-Za-z0-9_-]{22})(?=[/?#]|$)/.exec(trimmed);
  const token = fromPath?.[1] ?? (SHORT.test(trimmed) ? trimmed : null);
  if (!token) return trimmed;
  return decodeShortItemId(token) ?? trimmed;
}
