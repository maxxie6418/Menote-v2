import { getAttachment, listAttachments, upsertAttachment } from "../db/attachments";
import { readSettingState } from "../db/sync";

/**
 * 附件服务（G5，FR-SYNC-7/8）：R2 内容寻址存储与元数据编排。
 * R2 键按用户隔离（<userId>/<sha256>）；SQL 在 db/attachments.ts。
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

export async function listUserAttachments(db: D1Database, userId: string) {
  return listAttachments(db, userId);
}

/** 上传：大小校验 → 服务端重算 sha256 → R2 写入 → 元数据 upsert；载荷非法抛 invalid_attachment。 */
export async function storeAttachment(ctx: AttachmentStoreContext, userId: string, body: ArrayBuffer, rawMime: string | undefined, filename: string | undefined) {
  const policy = await readAttachmentPolicy(ctx.db, userId);
  const extension = filename?.split(/[\\/]/).pop()?.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? "";
  if (body.byteLength === 0 || body.byteLength > Math.min(MAX_ATTACHMENT_BYTES, policy.maxBytes) || !extension || !policy.allowedExtensions.includes(extension)) throw new Error("invalid_attachment");
  const digest = await crypto.subtle.digest("SHA-256", body);
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const mime = rawMime?.split(";")[0] ?? "application/octet-stream";
  const key = `${userId}/${sha256}`;
  await ctx.bucket.put(key, body);
  try {
    await upsertAttachment(ctx.db, userId, sha256, body.byteLength, mime);
  } catch (error) {
    // 并发上传可能已写入相同对象；无跨 D1/R2 互斥时保留对象，避免补偿误删。
    throw error;
  }
  return { sha256, size: body.byteLength, mime };
}

/** 读取：元数据与 R2 对象任一缺失视为不存在（路由映射 404）。 */
export async function readUserAttachment(ctx: AttachmentStoreContext, userId: string, sha256: string) {
  const meta = await getAttachment(ctx.db, userId, sha256);
  if (!meta) return null;
  const object = await ctx.bucket.get(`${userId}/${sha256}`);
  if (!object) return null;
  return { mime: meta.mime, object };
}
