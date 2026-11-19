import { isSealedAttachment, SEALED_ATTACHMENT_MIME, SEALED_ATTACHMENT_OVERHEAD } from "@menote/shared";
import {
  acknowledgeAttachmentDeletions, claimDueAttachmentDeletions, getAttachmentObject, listAttachments, publishAttachmentStatements,
  reserveAttachmentObjects, retireExpiredAttachments, retireUserAttachment, reuseAttachmentObject,
} from "../db/attachments";
import { readSettingState } from "../db/sync";

/**
 * 附件服务（G5，FR-SYNC-7/8）：R2 内容寻址存储与元数据编排。
 * R2 对象以用户、哈希和独立世代隔离；SQL 在 db/attachments.ts。
 * 上传上限与哈希重算在本层（不信任客户端哈希）。
 */

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const DEFAULT_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "md"];

export interface AttachmentPolicy { maxBytes: number; allowedExtensions: string[] }

export async function readAttachmentPolicy(db: D1Database, userId: string): Promise<AttachmentPolicy> {
  const setting = await readSettingState(db, userId, "attachmentPolicy");
  const raw = setting?.sensitivity === "ordinary" && typeof setting.value === "object" && setting.value !== null
    ? setting.value as Partial<AttachmentPolicy> : {};
  return {
    maxBytes: typeof raw.maxBytes === "number" && Number.isFinite(raw.maxBytes) ? Math.max(1, Math.min(MAX_ATTACHMENT_BYTES, Math.floor(raw.maxBytes))) : MAX_ATTACHMENT_BYTES,
    allowedExtensions: Array.isArray(raw.allowedExtensions)
      ? [...new Set(raw.allowedExtensions.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.toLowerCase().replace(/^\./, "").trim()).filter((entry) => /^[a-z0-9]{1,12}$/.test(entry)))].slice(0, 64)
      : DEFAULT_EXTENSIONS,
  };
}

export interface AttachmentStoreContext { db: D1Database; bucket: R2Bucket }

export async function listUserAttachments(db: D1Database, userId: string, cursor: string) {
  return listAttachments(db, userId, cursor);
}

/** A durable reservation lets scheduled cleanup recover staging objects after a failed write. */
export async function stageAttachmentObjects<T extends { sha256: string; bytes: ArrayBuffer | Uint8Array }>(
  ctx: AttachmentStoreContext, userId: string, files: readonly T[],
): Promise<Array<T & { key: string }>> {
  if (!files.length) return [];
  const objects = files.map((file) => ({ ...file, key: `${userId}/${file.sha256}/${crypto.randomUUID()}` }));
  await reserveAttachmentObjects(ctx.db, objects.map((object) => object.key), Date.now());
  for (const object of objects) await ctx.bucket.put(object.key, object.bytes);
  return objects;
}

/** 上传：大小校验、重算哈希，然后复用现有对象或发布新世代。 */
export async function storeAttachment(ctx: AttachmentStoreContext, userId: string, body: ArrayBuffer, rawMime: string | undefined, filename: string | undefined) {
  const policy = await readAttachmentPolicy(ctx.db, userId);
  const mime = rawMime?.split(";")[0] ?? "application/octet-stream";
  const sealed = mime === SEALED_ATTACHMENT_MIME;
  const payloadSize = body.byteLength - (sealed ? SEALED_ATTACHMENT_OVERHEAD : 0);
  const extension = filename?.split(/[\\/]/).pop()?.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? "";
  if (payloadSize <= 0 || payloadSize > Math.min(MAX_ATTACHMENT_BYTES, policy.maxBytes) ||
    (sealed ? !isSealedAttachment(new Uint8Array(body)) : !extension || !policy.allowedExtensions.includes(extension))) {
    throw new Error("invalid_attachment");
  }
  const digest = await crypto.subtle.digest("SHA-256", body);
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const current = await getAttachmentObject(ctx.db, userId, sha256);
  if (current && await ctx.bucket.head(current.key) &&
    await reuseAttachmentObject(ctx.db, userId, sha256, current.key, body.byteLength, mime, Date.now())) {
    return { sha256, size: body.byteLength, mime };
  }
  const [staged] = await stageAttachmentObjects(ctx, userId, [{ sha256, bytes: body }]);
  await ctx.db.batch(publishAttachmentStatements(ctx.db, userId, sha256, body.byteLength, mime, staged!.key, Date.now()));
  return { sha256, size: body.byteLength, mime };
}

/** 读取：元数据与 R2 对象任一缺失视为不存在（路由映射 404）。 */
export async function readUserAttachment(ctx: AttachmentStoreContext, userId: string, sha256: string) {
  const meta = await getAttachmentObject(ctx.db, userId, sha256);
  if (!meta) return null;
  const object = await ctx.bucket.get(meta.key);
  if (!object) return null;
  return { mime: meta.mime, object };
}

async function deleteRetiredObjects(ctx: AttachmentStoreContext, keys: string[]): Promise<void> {
  if (!keys.length) return;
  await ctx.bucket.delete(keys);
  await acknowledgeAttachmentDeletions(ctx.db, keys);
}

export async function deleteUserAttachment(ctx: AttachmentStoreContext, userId: string, sha256: string, now = Date.now()) {
  const result = await retireUserAttachment(ctx.db, userId, sha256, now);
  if (result.status !== "retired") return result.status;
  await deleteRetiredObjects(ctx, [result.key]);
  return "deleted" as const;
}

export async function cleanupAttachments(ctx: AttachmentStoreContext, now: number): Promise<void> {
  await retireExpiredAttachments(ctx.db, now);
  await deleteRetiredObjects(ctx, await claimDueAttachmentDeletions(ctx.db, now));
}
