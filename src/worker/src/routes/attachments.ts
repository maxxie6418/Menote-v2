import { Hono } from "hono";
import { SEALED_ATTACHMENT_MIME, SEALED_ATTACHMENT_OVERHEAD } from "@menote/shared";
import type { AppEnv } from "../middleware/session";
import { requireSession, resolveSession, sameOriginGuard } from "../middleware/session";
import { ensureSchemaReady, pepperKeyMaterial } from "../services/authService";
import {
  deleteUserAttachment, listUserAttachments, readAttachmentPolicy, readUserAttachment, storeAttachment,
} from "../services/attachmentService";

/** 附件路由（G5）：R2 内容寻址存储 + 鉴权读取（FR-SYNC-7/8）。
 *  编排（上限/哈希/R2 写入）在 attachmentService；本层只做鉴权、
 *  请求形态校验与 HTTP 映射。跨源变更请求走 sameOriginGuard。 */
export const attachmentRoutes = new Hono<AppEnv>();

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** 会话解析必须覆盖子路径：`.use("/api/attachments")` 只匹配这一个精确路径，
 *  而读取/删除都在 `/api/attachments/:sha256`——漏挂后 requireSession 拿不到 authUser，
 *  图片一律 401 裂图（上传是精确路径 POST，所以只有"看图"坏）。 */
attachmentRoutes.use("/api/attachments", resolveSession);
attachmentRoutes.use("/api/attachments/*", resolveSession);

attachmentRoutes.get("/api/attachments", requireSession, async (c) => {
  if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
  const cursor = c.req.query("cursor") ?? "";
  if (cursor && !SHA256_PATTERN.test(cursor)) return c.json({ error: "invalid_cursor" }, 400);
  const page = await listUserAttachments(c.env.DB, c.get("authUser")!.id, cursor);
  return c.json(page, { headers: { "Cache-Control": "no-store" } });
});

attachmentRoutes.post("/api/attachments", sameOriginGuard, requireSession, async (c) => {
  try {
    if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
    const userId = c.get("authUser")!.id;
    const contentLength = Number(c.req.header("Content-Length"));
    const policy = await readAttachmentPolicy(c.env.DB, userId);
    const overhead = c.req.header("Content-Type")?.split(";")[0] === SEALED_ATTACHMENT_MIME ? SEALED_ATTACHMENT_OVERHEAD : 0;
    if (Number.isFinite(contentLength) && contentLength > policy.maxBytes + overhead) return c.json({ error: "invalid_attachment" }, 400);
    const body = await c.req.arrayBuffer();
    const filename = c.req.header("X-File-Extension") ?? "";
    const result = await storeAttachment(
      { db: c.env.DB, bucket: c.env.BUCKET }, userId, body, c.req.header("Content-Type"), filename,
    );
    return c.json(result, 201);
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_attachment") return c.json({ error: "invalid_attachment" }, 400);
    return c.json({ error: "unavailable" }, 503);
  }
});

attachmentRoutes.get("/api/attachments/:sha256", requireSession, async (c) => {
  if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
  const sha256 = c.req.param("sha256");
  if (!SHA256_PATTERN.test(sha256)) return c.json({ error: "invalid_attachment" }, 400);
  const found = await readUserAttachment(
    { db: c.env.DB, bucket: c.env.BUCKET }, c.get("authUser")!.id, sha256,
  );
  if (!found) return c.json({ error: "not_found" }, 404);
  return new Response(found.object.body, {
    headers: {
      "Content-Type": found.mime,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

attachmentRoutes.delete("/api/attachments/:sha256", sameOriginGuard, requireSession, async (c) => {
  const sha256 = c.req.param("sha256");
  if (!SHA256_PATTERN.test(sha256)) return c.json({ error: "invalid_attachment" }, 400);
  try {
    pepperKeyMaterial(c.env);
    if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
    const result = await deleteUserAttachment({ db: c.env.DB, bucket: c.env.BUCKET }, c.get("authUser")!.id, sha256);
    if (result === "not_found") return c.json({ error: result }, 404);
    if (result !== "deleted") return c.json({ error: result }, 409);
    return c.body(null, 204);
  } catch {
    return c.json({ error: "unavailable" }, 503);
  }
});
