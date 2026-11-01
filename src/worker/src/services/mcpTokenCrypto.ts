const encoder = new TextEncoder();

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function encodeBase64Url(bytes: Uint8Array): string {
  return encodeBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function encryptionKey(pepper: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", encoder.encode(pepper), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: encoder.encode("menote/mcp-token-v1") },
    base, { name: "AES-GCM", length: 256 }, false, usage,
  );
}

export async function sealMcpToken(pepper: string, token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, await encryptionKey(pepper, ["encrypt"]), encoder.encode(token),
  );
  const result = new Uint8Array(iv.length + cipher.byteLength);
  result.set(iv);
  result.set(new Uint8Array(cipher), iv.length);
  return encodeBase64(result);
}

export async function openMcpToken(pepper: string, sealed: string): Promise<string> {
  const bytes = decodeBase64(sealed);
  if (bytes.byteLength < 29) throw new Error("invalid_token_ciphertext");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, 12) }, await encryptionKey(pepper, ["decrypt"]), bytes.slice(12),
  );
  return new TextDecoder().decode(plain);
}

export async function hashMcpToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generateMcpToken(): string {
  return `mn_${encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
}
