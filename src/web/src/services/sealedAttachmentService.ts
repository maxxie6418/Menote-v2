import { isSealedAttachment, SEALED_ATTACHMENT_IV_BYTES, SEALED_ATTACHMENT_MAGIC, SEALED_ATTACHMENT_MIME, SEALED_ATTACHMENT_MIME_BYTES } from "@menote/shared";
import { attachmentUrl, exportAttachmentZip, postSealedAttachment } from "./attachmentService";
import { readAttachmentPolicy } from "./attachmentPolicyService";
import { notifyEditorChange, registerEditorSave } from "./editorSaveService";
import { getContentKey } from "./keyringService";

const encoder = new TextEncoder();
const ivOffset = SEALED_ATTACHMENT_MAGIC.length;
const bodyOffset = ivOffset + SEALED_ATTACHMENT_IV_BYTES;
const verifiedFiles = new WeakMap<Uint8Array, Set<string>>();

async function attachmentKey(raw: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", raw as BufferSource, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: encoder.encode("menote/sealed-attachment/v1") },
    key, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}

function fileMime(value: string): string {
  const mime = value.toLowerCase();
  return mime.length < SEALED_ATTACHMENT_MIME_BYTES && /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(mime)
    ? mime : "application/octet-stream";
}

export async function sealAttachment(file: Blob, key: Uint8Array): Promise<Blob> {
  if (file.size === 0) throw new Error("invalid_attachment");
  const payload = new Uint8Array(SEALED_ATTACHMENT_MIME_BYTES + file.size);
  payload.set(encoder.encode(fileMime(file.type)));
  payload.set(new Uint8Array(await file.arrayBuffer()), SEALED_ATTACHMENT_MIME_BYTES);
  try {
    const iv = crypto.getRandomValues(new Uint8Array(SEALED_ATTACHMENT_IV_BYTES));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await attachmentKey(key), payload);
    return new Blob([Uint8Array.from(SEALED_ATTACHMENT_MAGIC), iv, ciphertext], { type: SEALED_ATTACHMENT_MIME });
  } finally { payload.fill(0); }
}

export async function openSealedAttachment(file: Blob, key: Uint8Array): Promise<Blob> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isSealedAttachment(bytes)) throw new Error("invalid_attachment");
  const iv = bytes.subarray(ivOffset, bodyOffset);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await attachmentKey(key), bytes.subarray(bodyOffset));
  const payload = new Uint8Array(decrypted);
  try {
    const mime = new TextDecoder().decode(payload.subarray(0, SEALED_ATTACHMENT_MIME_BYTES)).replace(/\0+$/, "");
    return new Blob([payload.subarray(SEALED_ATTACHMENT_MIME_BYTES)], { type: fileMime(mime) });
  } finally { payload.fill(0); }
}

function remember(key: Uint8Array, sha256: string) {
  const existing = verifiedFiles.get(key) ?? new Set<string>();
  existing.add(sha256);
  verifiedFiles.set(key, existing);
}

export async function uploadSealedAttachment(userId: string, itemId: string, file: File, onProgress?: (percent: number) => void) {
  const key = getContentKey(itemId);
  if (!key) return { error: "locked" } as const;
  const unregister = registerEditorSave(userId, async () => false);
  notifyEditorChange();
  try {
    const policy = await readAttachmentPolicy(userId);
    const extension = file.name.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
    if (!file.size || file.size > policy.maxBytes) return { error: "size_exceeded" } as const;
    if (!extension || !policy.allowedExtensions.includes(extension)) return { error: "format_not_allowed" } as const;
    const sealed = await sealAttachment(file, key);
    if (getContentKey(itemId) !== key) return { error: "locked" } as const;
    const result = await postSealedAttachment(new File([sealed], "sealed", { type: SEALED_ATTACHMENT_MIME }), onProgress);
    if ("error" in result) return result;
    if (getContentKey(itemId) !== key) return { error: "locked" } as const;
    remember(key, result.sha256);
    return { sha256: result.sha256, name: file.name };
  } catch {
    return { error: "attachment_encryption_failed" } as const;
  } finally {
    unregister();
    notifyEditorChange();
  }
}

/** Legacy clear files already associated with a note remain readable after unlock. */
export async function readUnlockedAttachment(itemId: string, sha256: string, signal?: AbortSignal) {
  const key = getContentKey(itemId);
  if (!key) throw new Error("locked");
  const response = await fetch(attachmentUrl(sha256), { cache: "no-store", signal });
  if (!response.ok) throw new Error("attachment_unavailable");
  const raw = await response.blob();
  const sealed = raw.type === SEALED_ATTACHMENT_MIME;
  const blob = sealed ? await openSealedAttachment(raw, key) : raw;
  if (signal?.aborted || getContentKey(itemId) !== key) throw new Error("locked");
  if (sealed) remember(key, sha256);
  return { blob, sealed };
}

export async function verifyAddedSealedAttachments(itemId: string, hashes: string[], existing: string[]): Promise<void> {
  const key = getContentKey(itemId);
  if (!key) throw new Error("locked");
  for (const hash of hashes) {
    if (existing.includes(hash) || verifiedFiles.get(key)?.has(hash)) continue;
    try {
      if ((await readUnlockedAttachment(itemId, hash)).sealed) continue;
    } catch { /* Missing, locked, or encrypted under a different note key. */ }
    throw new Error("请通过加密笔记的附件入口上传文件。");
  }
  if (getContentKey(itemId) !== key) throw new Error("locked");
}

export async function exportUnlockedAttachmentZip(itemId: string, title: string, markdown: string) {
  const key = getContentKey(itemId);
  if (!key) return { ok: false, error: "locked" } as const;
  return exportAttachmentZip(title, markdown, async (hash) => (await readUnlockedAttachment(itemId, hash)).blob,
    () => getContentKey(itemId) === key);
}
