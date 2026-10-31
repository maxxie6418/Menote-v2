/** 加密原语门面（G7，G4 设计 §1）：全部 WebCrypto 原生；KDF 一律客户端执行。 */

const KDF_ITERATIONS = 600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toB64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export function fromB64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function deriveKekBytes(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, base, 256,
  );
  return new Uint8Array(bits);
}

async function importAesGcm(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function aesEncrypt(key: CryptoKey, plaintext: Uint8Array): Promise<{ iv: string; ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plaintext as BufferSource));
  return { iv: toB64(iv), ciphertext: toB64(sealed) };
}

async function aesDecrypt(key: CryptoKey, iv: string, ciphertext: string): Promise<Uint8Array> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(iv) as BufferSource }, key, fromB64(ciphertext) as BufferSource,
  );
  return new Uint8Array(plain);
}

export interface RawWrap {
  wrapper: "password" | "recovery" | "topic";
  kdfSalt: string;
  kdfIterations: number;
  iv: string;
  ciphertext: string;
  generation: number;
}

/** 用凭据包装 32B 内容密钥（G4 §2：盐独立、迭代随块自存）。 */
export async function wrapContentKey(rawKey: Uint8Array, credential: string, wrapper: RawWrap["wrapper"], generation = 0): Promise<RawWrap> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kekBytes = await deriveKekBytes(credential, salt, KDF_ITERATIONS);
  const sealed = await aesEncrypt(await importAesGcm(kekBytes), rawKey);
  return { wrapper, kdfSalt: toB64(salt), kdfIterations: KDF_ITERATIONS, ...sealed, generation };
}

/** 凭凭据解开包装块；口令错误由 GCM 校验失败抛出。 */
export async function unwrapContentKey(wrap: RawWrap, credential: string): Promise<Uint8Array> {
  const kekBytes = await deriveKekBytes(credential, fromB64(wrap.kdfSalt), wrap.kdfIterations);
  return aesDecrypt(await importAesGcm(kekBytes), wrap.iv, wrap.ciphertext);
}

export function generateContentKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function encryptMarkdown(markdown: string, rawKey: Uint8Array): Promise<{ iv: string; ciphertext: string }> {
  return aesEncrypt(await importAesGcm(rawKey), encoder.encode(markdown));
}

export async function decryptMarkdown(envelope: { iv: string; ciphertext: string }, rawKey: Uint8Array): Promise<string> {
  return decoder.decode(await aesDecrypt(await importAesGcm(rawKey), envelope.iv, envelope.ciphertext));
}

const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford：无 I/L/O/U

/** 恢复码（G4 §3）：160-bit 熵 → Crockford Base32 32 字符，8×4 分组；明文永不入库。 */
export function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let text = "";
  for (const byte of bytes) text += CODE_ALPHABET[byte % 32];
  return (text.match(/.{4}/g) ?? []).join("-");
}
