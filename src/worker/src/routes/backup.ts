import { Hono } from "hono";
import type { AppEnv } from "../middleware/session";
import { requireSession, resolveSession, sameOriginGuard } from "../middleware/session";
import {
  createTarget, deleteTarget, getTarget, listTargets, recordTargetResult, updateTarget,
} from "../db/backup";
import { ensureSchemaReady } from "../services/authService";
import { deleteRemoteBackup, listRemoteBackups, openSecret, pushBackup, sealSecret, testRemoteTarget } from "../services/backupService";

/** 备份目标管理与手动推送（G9，FR-BAK-1/2/8）。凭据可逆加密存储、支持复显（C-7）。 */

function pepper(env: Env): string {
  const value: unknown = Reflect.get(env, "AUTH_PEPPER");
  if (typeof value !== "string" || !value.trim()) throw new Error("unconfigured");
  return value;
}

async function requireReady(c: { env: Env }): Promise<boolean> {
  return ensureSchemaReady(c.env.DB);
}

export const backupRoutes = new Hono<AppEnv>();

backupRoutes.use("/api/backup", resolveSession);

backupRoutes.get("/api/backup/targets", resolveSession, requireSession, async (c) => {
  if (!(await requireReady(c))) return c.json({ error: "unavailable" }, 503);
  const targets = await listTargets(c.env.DB, c.get("authUser")!.id);
  // 复显口径（C-7）：返回密文；明文仅在推送与显式查看时由服务端解开。
  return c.json({ targets }, { headers: { "Cache-Control": "no-store" } });
});

backupRoutes.post("/api/backup/test", resolveSession, sameOriginGuard, requireSession, async (c) => {
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || (body.kind !== "webdav" && body.kind !== "s3") || typeof body.endpoint !== "string" || typeof body.secret !== "string") return c.json({ error: "invalid_request" }, 400);
  const result = await testRemoteTarget({
    kind: body.kind, endpoint: body.endpoint, bucket: typeof body.bucket === "string" ? body.bucket : null,
    username: typeof body.username === "string" ? body.username : null, secret: body.secret,
    remotePath: typeof body.remotePath === "string" ? body.remotePath : "menote", retentionCount: 0,
  });
  return c.json(result, { status: result.ok ? 200 : 502 });
});

backupRoutes.post("/api/backup/targets/:id/test", resolveSession, sameOriginGuard, requireSession, async (c) => {
  if (!(await requireReady(c))) return c.json({ error: "unavailable" }, 503);
  const target = await getTarget(c.env.DB, c.get("authUser")!.id, c.req.param("id"));
  if (!target) return c.json({ error: "not_found" }, 404);
  try {
    const secret = await openSecret(pepper(c.env), target.secretCiphertext ?? "");
    const result = await testRemoteTarget({ ...target, kind: target.kind === "s3" ? "s3" : "webdav", secret, remotePath: target.remotePath, retentionCount: target.retentionCount });
    return c.json(result, { status: result.ok ? 200 : 502 });
  } catch (error) {
    return c.json({ ok: false, error: String(error).slice(0, 300) }, 502);
  }
});

backupRoutes.post("/api/backup/targets", resolveSession, sameOriginGuard, requireSession, async (c) => {
  try {
    if (!(await requireReady(c))) return c.json({ error: "unavailable" }, 503);
    const body: unknown = await c.req.json().catch(() => null);
    const input = body as {
      kind?: unknown; endpoint?: unknown; bucket?: unknown; username?: unknown; remotePath?: unknown; retentionCount?: unknown;
      secret?: unknown; deletePolicy?: unknown; schedule?: unknown; name?: unknown;
    };
    if (input.kind !== "s3" && input.kind !== "webdav") return c.json({ error: "invalid_request" }, 400);
    if (typeof input.endpoint !== "string" || !input.endpoint.startsWith("http")) return c.json({ error: "invalid_request" }, 400);
    if (typeof input.secret !== "string" || input.secret.length === 0) return c.json({ error: "invalid_request" }, 400);
    const id = await createTarget(c.env.DB, c.get("authUser")!.id, {
      kind: input.kind,
      endpoint: input.endpoint.slice(0, 500),
      bucket: typeof input.bucket === "string" && input.bucket ? input.bucket : null,
      username: typeof input.username === "string" ? input.username : null,
      secretCiphertext: await sealSecret(pepper(c.env), input.secret),
      deletePolicy: input.deletePolicy === "sync" ? "sync" : "append_only",
      schedule: input.schedule === "daily" || input.schedule === "weekly" ? input.schedule : "manual",
      name: typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 100) : "备份目标",
      remotePath: typeof input.remotePath === "string" && input.remotePath.trim() ? input.remotePath.trim().slice(0, 300) : "menote",
      retentionCount: typeof input.retentionCount === "number" && Number.isInteger(input.retentionCount) ? Math.max(0, Math.min(1000, input.retentionCount)) : 0,
    });
    return c.json({ id }, 201);
  } catch (error) {
    console.error("backup target create failed:", error);
    return c.json({ error: "unavailable" }, 503);
  }
});

backupRoutes.patch("/api/backup/targets/:id", resolveSession, sameOriginGuard, requireSession, async (c) => {
  try {
    if (!(await requireReady(c))) return c.json({ error: "unavailable" }, 503);
    const body: unknown = await c.req.json().catch(() => null);
    const patch = body as { name?: unknown; endpoint?: unknown; bucket?: unknown; username?: unknown; secret?: unknown; schedule?: unknown; enabled?: unknown; remotePath?: unknown; retentionCount?: unknown };
    await updateTarget(c.env.DB, c.get("authUser")!.id, c.req.param("id"), {
      ...(typeof patch.name === "string" ? { name: patch.name.slice(0, 100) } : {}),
      ...(typeof patch.endpoint === "string" ? { endpoint: patch.endpoint.slice(0, 500) } : {}),
      ...(typeof patch.bucket === "string" ? { bucket: patch.bucket } : {}),
      ...(typeof patch.username === "string" ? { username: patch.username } : {}),
      ...(typeof patch.secret === "string" && patch.secret ? { secretCiphertext: await sealSecret(pepper(c.env), patch.secret) } : {}),
      ...(patch.schedule === "daily" || patch.schedule === "weekly" || patch.schedule === "manual" ? { schedule: patch.schedule } : {}),
      ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
      ...(typeof patch.remotePath === "string" ? { remotePath: patch.remotePath.trim().slice(0, 300) || "menote" } : {}),
      ...(typeof patch.retentionCount === "number" && Number.isInteger(patch.retentionCount) ? { retentionCount: Math.max(0, Math.min(1000, patch.retentionCount)) } : {}),
    });
    return c.json({ ok: true });
  } catch {
    return c.json({ error: "unavailable" }, 503);
  }
});

backupRoutes.get("/api/backup/targets/:id/backups", resolveSession, requireSession, async (c) => {
  if (!(await requireReady(c))) return c.json({ error: "unavailable" }, 503);
  const userId = c.get("authUser")!.id;
  const target = await getTarget(c.env.DB, userId, c.req.param("id"));
  if (!target) return c.json({ error: "not_found" }, 404);
  try {
    const secret = await openSecret(pepper(c.env), target.secretCiphertext ?? "");
    const backups = await listRemoteBackups({ ...target, kind: target.kind === "s3" ? "s3" : "webdav", secret, remotePath: target.remotePath, retentionCount: target.retentionCount });
    return c.json({ backups }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return c.json({ error: String(error).slice(0, 300) }, 502);
  }
});

backupRoutes.delete("/api/backup/targets/:id/backups/:backupId", resolveSession, sameOriginGuard, requireSession, async (c) => {
  if (!(await requireReady(c))) return c.json({ error: "unavailable" }, 503);
  const userId = c.get("authUser")!.id;
  const target = await getTarget(c.env.DB, userId, c.req.param("id"));
  if (!target) return c.json({ error: "not_found" }, 404);
  try {
    const secret = await openSecret(pepper(c.env), target.secretCiphertext ?? "");
    await deleteRemoteBackup({ ...target, kind: target.kind === "s3" ? "s3" : "webdav", secret, remotePath: target.remotePath, retentionCount: target.retentionCount }, c.req.param("backupId"));
    return c.json({ ok: true });
  } catch (error) {
    return c.json({ error: String(error).slice(0, 300) }, 502);
  }
});

backupRoutes.delete("/api/backup/targets/:id", resolveSession, sameOriginGuard, requireSession, async (c) => {
  await deleteTarget(c.env.DB, c.get("authUser")!.id, c.req.param("id"));
  return c.json({ ok: true });
});

/** 手动「推送一次」（FR-BAK-2）：与定时同一流程。 */
backupRoutes.post("/api/backup/run/:id", resolveSession, sameOriginGuard, requireSession, async (c) => {
  if (!(await requireReady(c))) return c.json({ error: "unavailable" }, 503);
  const userId = c.get("authUser")!.id;
  const target = await getTarget(c.env.DB, userId, c.req.param("id"));
  if (!target || !target.enabled) return c.json({ error: "target_disabled" }, 409);
  try {
    const secret = await openSecret(pepper(c.env), target.secretCiphertext ?? "");
    const result = await pushBackup(
      { db: c.env.DB, userId, bucket: c.env.BUCKET },
      { kind: target.kind === "s3" ? "s3" : "webdav", endpoint: target.endpoint ?? "", bucket: target.bucket, username: target.username, secret, remotePath: target.remotePath, retentionCount: target.retentionCount },
    );
    const pushedAt = Date.now();
    await recordTargetResult(c.env.DB, userId, target.id, result.ok ? `ok:${new Date(pushedAt!).toISOString()}:${result.shards} 分片` : `失败:${result.error}`, pushedAt);
    return c.json(result.ok ? { ok: true, shards: result.shards, backupId: result.backupId } : { ok: false, error: result.error }, { status: result.ok ? 200 : 502 });
  } catch (error) {
    await recordTargetResult(c.env.DB, userId, target.id, `失败:${String(error).slice(0, 200)}`, Date.now());
    return c.json({ ok: false, error: "unavailable" }, 503);
  }
});

/** 凭据复显（C-7：支持事后查看与复制分发；会话内）。 */
backupRoutes.get("/api/backup/targets/:id/secret", resolveSession, requireSession, async (c) => {
  const target = await getTarget(c.env.DB, c.get("authUser")!.id, c.req.param("id"));
  if (!target) return c.json({ error: "not_found" }, 404);
  try {
    return c.json({ secret: await openSecret(pepper(c.env), target.secretCiphertext ?? "") }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return c.json({ error: "unavailable" }, 503);
  }
});
