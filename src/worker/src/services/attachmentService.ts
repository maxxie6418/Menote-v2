import { deleteAttachmentIfUnreferenced, getAttachment, listAttachments, upsertAttachment } from "../db/attachments";

/**
 * 附件服务（G5，FR-SYNC-7/8）：R2 内容寻址存储与元数据编排。
 * R2 键按用户隔离（<userId>/<sha256>）；SQL 在 db/attachments.ts。
 * 上传上限与哈希重算在本层（不信任客户端哈希）。
 */

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export interface AttachmentStoreContext { db: D1Database; bucket: R2Bucket }

export async function listUserAttachments(db: D1Database, userId: string) {
  return listAttachments(db, userId);
}

/** 上传：大小校验 → 服务端重算 sha256 → R2 写入 → 元数据 upsert；载荷非法抛 invalid_attachment。 */
export async function storeAttachment(ctx: AttachmentStoreContext, userId: string, body: ArrayBuffer, rawMime: string | undefined) {
  if (body.byteLength === 0 || body.byteLength > MAX_ATTACHMENT_BYTES) throw new Error("invalid_attachment");
  const digest = await crypto.subtle.digest("SHA-256", body);
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const mime = rawMime?.split(";")[0] ?? "application/octet-stream";
  const key = `${userId}/${sha256}`;
  const existed = (await ctx.bucket.head(key)) !== null;
  await ctx.bucket.put(key, body);
  try {
    await upsertAttachment(ctx.db, userId, sha256, body.byteLength, mime);
  } catch (error) {
    // Compensate only newly-created objects; never remove a prior valid object on metadata failure.
    // 并发同内容上传（或引用对齐补行）可能在补偿前提交元数据行：删除对象前后各查一次，
    // 若行已出现则把对象放回，避免把对方的引用删成断链；残余窗口由下次同内容上传自愈。
    if (!existed && await getAttachment(ctx.db, userId, sha256) === null) {
      try { await ctx.bucket.delete(key); } catch { /* orphan cleanup will reconcile transient R2 failures */ }
      if (await getAttachment(ctx.db, userId, sha256) !== null) {
        try { await ctx.bucket.put(key, body); } catch { /* 对象缺失由下次同内容上传或 30 天孤儿清理兜底 */ }
      }
    }
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

/** 删除：仅零引用可删（引用中返回 false → 路由映射 409 referenced）；删行后移除 R2 对象。 */
export async function deleteUserAttachment(ctx: AttachmentStoreContext, userId: string, sha256: string): Promise<boolean> {
  const deleted = await deleteAttachmentIfUnreferenced(ctx.db, userId, sha256);
  if (!deleted) return false;
  await ctx.bucket.delete(`${userId}/${sha256}`);
  return true;
}
