/** Format v1: magic, 12-byte IV, AES-GCM payload and tag. MIME is inside the payload. */
export const SEALED_ATTACHMENT_MIME = "application/vnd.menote.sealed-attachment";
export const SEALED_ATTACHMENT_MAGIC = [0x4d, 0x4e, 0x41, 1] as const;
export const SEALED_ATTACHMENT_MIME_BYTES = 96;
export const SEALED_ATTACHMENT_IV_BYTES = 12;
export const SEALED_ATTACHMENT_OVERHEAD = SEALED_ATTACHMENT_MAGIC.length + SEALED_ATTACHMENT_IV_BYTES + 16 + SEALED_ATTACHMENT_MIME_BYTES;

export function isSealedAttachment(bytes: Uint8Array): boolean {
  return bytes.length > SEALED_ATTACHMENT_OVERHEAD && SEALED_ATTACHMENT_MAGIC.every((byte, index) => bytes[index] === byte);
}
