import { Hono } from "hono";
import type { AppEnv } from "../middleware/session";
import { requireSession, resolveSession, sameOriginGuard } from "../middleware/session";
import { ensureSchemaReady } from "../services/authService";
import { deleteRemoteBackup, listRemoteBackups } from "../services/backupService";
import {
  applyTargetPatch, createTargetSealed, deleteTargetForUser, getTargetForUser, listTargetsForUser,
  normalizeTargetInput, openTargetSecret, runTargetPushById, testUnsavedTarget, toRemoteTarget, type TargetInput,
} from "../services/backupTargetService";

/** 备份目标管理与手动推送路由（G9，FR-BAK-1/2/8）。
 *  目标归一/凭据密封与解封/推送编排/恢复导入编排在 services；本层只做鉴权、
 *  请求形态透传与 HTTP 状态映射（凭据复显口径 C-7 由服务层保证）。 */

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
  const targets = await listTargetsForUser(c.env.DB, c.get("authUser")!.id);
  // 复显口径（C-7）：返回密文；明文仅在推送与显式查看时由服务端解开。
  return c.json({ targets }, { headers: { "Cache-Control": "no-store" } });
});

backupRoutes.post("/api/backup/test", resolveSession, sameOriginGuard, requireSession, async (c) => {
  const body = await c.req.json().catch(() => null) as TargetInput | null;
  if (!body) return c.json({ error: "invalid_request" }, 400);
  const result = await testUnsavedTarget(body);
  if (!result) return c.json({ error: "invalid_request" }, 400);
  return c.json(result, { status: result.ok ? 200 : 502 });
});

backupRoutes.post("/api/backup/targets/:id/test", resolveSession, sameOriginGuard, requireSession, async (c) => {
  if (!(await requireReady(c))) return c.json({ error: "unavailable" }, 503);
  const target = await getTargetForUser(c.env.DB, c.get("authUser")!.id, c.req.param("id"));
  if (!target) return c.json({ error: "not_found" }, 404);
  try {
    const secret = await openTargetSecret(pepper(c.env), target);
    const result = await testUnsavedTarget({ ...toRemoteTarget(target, secret) });
    return c.json(result, { status: result && result.ok ? 200 : 502 });
  } catch (error) {
    return c.json({ ok: false, error: String(error).slice(0, 300) }, 502);
  }
});

backupRoutes.post("/api/backup/targets", resolveSession, sameOriginGuard, requireSession, async (c) => {
  try {
    if (!(await requireReady(c))) return c.json({ error: "unavailable" }, 503);
    const input = await c.req.json().catch(() => null) as TargetInput | null;
    const normalized = input ? normalizeTargetInput(input) : null;
    if (!normalized) return c.json({ error: "invalid_request" }, 400);
    const id = await createTargetSealed(c.env.DB, c.get("authUser")!.id, pepper(c.env), normalized);
    return c.json({ id }, 201);
  } catch (error) {
    console.error("backup target create failed:", error);
    return c.json({ error: "unavailable" }, 503);
  }
});

backupRoutes.patch("/api/backup/targets/:id", resolveSession, sameOriginGuard, requireSession, async (c) => {
  try {
    if (!(await requireReady(c))) return c.json({ error: "unavailable" }, 503);
    const patch = await c.req.json().catch(() => null) as TargetInput | null;
    if (!patch) return c.json({ error: "invalid_request" }, 400);
    await applyTargetPatch(c.env.DB, c.get("authUser")!.id, pepper(c.env), c.req.param("id"), patch);
    return c.json({ ok: true });
  } catch {
    return c.json({ error: "unavailable" }, 503);
  }
});

backupRoutes.get("/api/backup/targets/:id/backups", resolveSession, requireSession, async (c) => {
  if (!(await requireReady(c))) return c.json({ error: "unavailable" }, 503);
  const target = await getTargetForUser(c.env.DB, c.get("authUser")!.id, c.req.param("id"));
  if (!target) return c.json({ error: "not_found" }, 404);
  try {
    const secret = await openTargetSecret(pepper(c.env), target);
    const backups = await listRemoteBackups(toRemoteTarget(target, secret));
    return c.json({ backups }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return c.json({ error: String(error).slice(0, 300) }, 502);
  }
});

backupRoutes.delete("/api/backup/targets/:id/backups/:backupId", resolveSession, sameOriginGuard, requireSession, async (c) => {
  if (!(await requireReady(c))) return c.json({ error: "unavailable" }, 503);
  const target = await getTargetForUser(c.env.DB, c.get("authUser")!.id, c.req.param("id"));
  if (!target) return c.json({ error: "not_found" }, 404);
  try {
    const secret = await openTargetSecret(pepper(c.env), target);
    await deleteRemoteBackup(toRemoteTarget(target, secret), c.req.param("backupId"));
    return c.json({ ok: true });
  } catch (error) {
    return c.json({ error: String(error).slice(0, 300) }, 502);
  }
});

backupRoutes.delete("/api/backup/targets/:id", resolveSession, sameOriginGuard, requireSession, async (c) => {
  await deleteTargetForUser(c.env.DB, c.get("authUser")!.id, c.req.param("id"));
  return c.json({ ok: true });
});

/** 手动「推送一次」（FR-BAK-2）：与定时同一流程（runTargetPushById）。 */
backupRoutes.post("/api/backup/run/:id", resolveSession, sameOriginGuard, requireSession, async (c) => {
  if (!(await requireReady(c))) return c.json({ error: "unavailable" }, 503);
  const result = await runTargetPushById(
    { db: c.env.DB, userId: c.get("authUser")!.id, bucket: c.env.BUCKET }, c.req.param("id"), pepper(c.env),
  );
  if ("status" in result) {
    if (result.status === "unavailable") return c.json({ ok: false, error: "unavailable" }, 503);
    return c.json({ error: "target_disabled" }, 409);
  }
  return c.json(
    result.ok ? { ok: true, shards: result.shards, backupId: result.backupId } : { ok: false, error: result.error },
    { status: result.ok ? 200 : 502 },
  );
});

/** 凭据复显（C-7：支持事后查看与复制分发；会话内）。 */
backupRoutes.get("/api/backup/targets/:id/secret", resolveSession, requireSession, async (c) => {
  const target = await getTargetForUser(c.env.DB, c.get("authUser")!.id, c.req.param("id"));
  if (!target) return c.json({ error: "not_found" }, 404);
  try {
    return c.json({ secret: await openTargetSecret(pepper(c.env), target) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return c.json({ error: "unavailable" }, 503);
  }
});
