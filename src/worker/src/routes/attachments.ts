import { Hono } from "hono";
import type { AppEnv } from "../middleware/session";
import { requireSession, resolveSession, sameOriginGuard } from "../middleware/session";
import {
  deleteAttachmentIfUnreferenced, getAttachment, listAttachments, upsertAttachment,
} from "../db/attachments";
import { ensureSchemaReady } from "../services/authService";

/** 附件路由（G5）：R2 内容寻址存储 + 鉴权读取（FR-SYNC-7/8）。
 *  R2 键按用户隔离；读取与列表都要求会话；跨源变更请求走 sameOriginGuard。 */
export const attachmentRoutes = new Hono<AppEnv>();

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

attachmentRoutes.use("/api/attachments", resolveSession);

attachmentRoutes.get("/api/attachments", requireSession, async (c) => {
  if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
  const attachments = await listAttachments(c.env.DB, c.get("authUser")!.id);
  return c.json({ attachments }, { headers: { "Cache-Control": "no-store" } });
});

attachmentRoutes.post("/api/attachments", sameOriginGuard, requireSession, async (c) => {
  try {
    if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
    const userId = c.get("authUser")!.id;
    const body = await c.req.arrayBuffer();
    if (body.byteLength === 0 || body.byteLength > MAX_ATTACHMENT_BYTES) {
      return c.json({ error: "invalid_attachment" }, 400);
    }
    const digest = await crypto.subtle.digest("SHA-256", body);
    const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const mime = c.req.header("Content-Type")?.split(";")[0] ?? "application/octet-stream";
    await c.env.BUCKET.put(`${userId}/${sha256}`, body);
    await upsertAttachment(c.env.DB, userId, sha256, body.byteLength, mime);
    return c.json({ sha256, size: body.byteLength, mime }, 201);
  } catch {
    return c.json({ error: "unavailable" }, 503);
  }
});

attachmentRoutes.get("/api/attachments/:sha256", requireSession, async (c) => {
  const sha256 = c.req.param("sha256");
  if (!/^[0-9a-f]{64}$/.test(sha256)) return c.json({ error: "invalid_attachment" }, 400);
  const userId = c.get("authUser")!.id;
  const meta = await getAttachment(c.env.DB, userId, sha256);
  if (!meta) return c.json({ error: "not_found" }, 404);
  const object = await c.env.BUCKET.get(`${userId}/${sha256}`);
  if (!object) return c.json({ error: "not_found" }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": meta.mime,
      "Cache-Control": "private, max-age=86400",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
});

attachmentRoutes.delete("/api/attachments/:sha256", sameOriginGuard, requireSession, async (c) => {
  const sha256 = c.req.param("sha256");
  if (!/^[0-9a-f]{64}$/.test(sha256)) return c.json({ error: "invalid_attachment" }, 400);
  const userId = c.get("authUser")!.id;
  const deleted = await deleteAttachmentIfUnreferenced(c.env.DB, userId, sha256);
  if (!deleted) return c.json({ error: "referenced" }, 409);
  await c.env.BUCKET.delete(`${userId}/${sha256}`);
  return c.json({ ok: true });
});
