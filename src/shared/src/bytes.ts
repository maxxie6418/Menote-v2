/** 字节与 base64 互转。分块拼接，避免 `String.fromCharCode(...bytes)` 在长正文上抛 RangeError。 */

const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + CHUNK, bytes.length)));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error("invalid_base64");
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** D1 / JSON 往返后的字节形态：Uint8Array、ArrayBuffer，或下标对象 / 数字数组。 */
export function asBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "number" && item >= 0 && item <= 255)) {
    return Uint8Array.from(value);
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 0 && entries.every(([key, item]) => /^\d+$/.test(key) && typeof item === "number" && item >= 0 && item <= 255)) {
      const bytes = new Uint8Array(entries.length);
      for (const [key, item] of entries) bytes[Number(key)] = Number(item);
      if ([...bytes.keys()].every((index) => bytes[index] !== undefined)) return bytes;
    }
  }
  return null;
}

const B64_MARK = "$b64";
const TEXT_BLOB_KEYS = new Set(["content_ciphertext"]);

export function encodeBackupValue(value: unknown): unknown {
  const bytes = asBytes(value);
  return bytes ? { [B64_MARK]: bytesToBase64(bytes) } : value;
}

export function encodeBackupRow(row: Record<string, unknown>): Record<string, unknown> {
  const encoded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) encoded[key] = encodeBackupValue(value);
  return encoded;
}

/** 把备份 JSON 里的字节标记还原。文本型 BLOB（信封字符串）还原成 UTF-8，其余保持字节。非法标记抛错。 */
export function decodeBackupRow(row: Record<string, unknown>): Record<string, unknown> {
  const decoded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value && typeof value === "object" && B64_MARK in (value as Record<string, unknown>)) {
      const packed = (value as Record<string, unknown>)[B64_MARK];
      if (typeof packed !== "string") throw new Error("invalid_backup_encoding");
      const bytes = base64ToBytes(packed);
      decoded[key] = TEXT_BLOB_KEYS.has(key) ? new TextDecoder().decode(bytes) : bytes;
      continue;
    }
    const bytes = asBytes(value);
    if (bytes && (key === "kdf_salt" || key === "iv" || key === "ciphertext" || key === "content_ciphertext" || key === "value_ciphertext")) {
      decoded[key] = TEXT_BLOB_KEYS.has(key) ? new TextDecoder().decode(bytes) : bytes;
      continue;
    }
    decoded[key] = value;
  }
  return decoded;
}

/** 包装块字段 → base64。已是合法 base64 的字符串原样返回；对象 / 非字节拒绝，避免写成 "[object Object]"。 */
export function wrapFieldToBase64(value: unknown): string {
  if (typeof value === "string") {
    base64ToBytes(value);
    return value;
  }
  const bytes = asBytes(value);
  if (!bytes) throw new Error("invalid_wrap_encoding");
  return bytesToBase64(bytes);
}
