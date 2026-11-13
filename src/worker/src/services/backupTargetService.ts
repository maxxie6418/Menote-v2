import {
  createTarget, deleteTarget, getTarget, listTargets, recordTargetResult, updateTarget,
} from "../db/backup";
import type { RemoteTarget } from "./backupRemote";
import { openSecret, pushBackup, sealSecret, testRemoteTarget } from "./backupService";

/**
 * 备份目标管理服务（G9，FR-BAK-1/2/8）：目标 CRUD 的输入归一、凭据封装与解封、
 * 推送编排（手动与定时共用同一流程）。凭据仅存可逆加密密文（C-7：默认不明文展示、
 * 支持事后查看与复制分发）；明文只在推送与显式查看时由本层解开，不落存储与日志。
 * SQL 在 db/backup.ts；远端协议在 backupRemote.ts；快照组装在 backupService.ts。
 */

type Target = NonNullable<Awaited<ReturnType<typeof getTarget>>>;

/** 目标创建/更新的原始载荷（路由层仅透传，合法性与默认值由本层归一）。 */
export interface TargetInput {
  kind: unknown; endpoint: unknown; bucket: unknown; username: unknown; remotePath: unknown;
  retentionCount: unknown; secret: unknown; deletePolicy: unknown; schedule: unknown; name: unknown;
  enabled?: unknown;
}

export interface NormalizedTargetInput {
  kind: "s3" | "webdav"; endpoint: string; bucket: string | null; username: string | null;
  secret: string; deletePolicy: "append_only" | "sync"; schedule: "manual" | "daily" | "weekly";
  name: string; remotePath: string; retentionCount: number;
}

/** 创建目标输入归一：非法返回 null（路由映射 400），其余字段按上限截断与默认值收敛。 */
export function normalizeTargetInput(input: TargetInput): NormalizedTargetInput | null {
  if (input.kind !== "s3" && input.kind !== "webdav") return null;
  if (typeof input.endpoint !== "string" || !input.endpoint.startsWith("http")) return null;
  if (typeof input.secret !== "string" || input.secret.length === 0) return null;
  return {
    kind: input.kind,
    endpoint: input.endpoint.slice(0, 500),
    bucket: typeof input.bucket === "string" && input.bucket ? input.bucket : null,
    username: typeof input.username === "string" ? input.username : null,
    secret: input.secret,
    deletePolicy: input.deletePolicy === "sync" ? "sync" : "append_only",
    schedule: input.schedule === "daily" || input.schedule === "weekly" ? input.schedule : "manual",
    name: typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 100) : "备份目标",
    remotePath: typeof input.remotePath === "string" && input.remotePath.trim() ? input.remotePath.trim().slice(0, 300) : "menote",
    retentionCount: typeof input.retentionCount === "number" && Number.isInteger(input.retentionCount) ? Math.max(0, Math.min(1000, input.retentionCount)) : 0,
  };
}

/** 创建目标（凭据密封入库）；密封或写库失败向上抛出（路由映射 503）。 */
export async function createTargetSealed(db: D1Database, userId: string, pepper: string, input: NormalizedTargetInput): Promise<string> {
  return createTarget(db, userId, {
    kind: input.kind, endpoint: input.endpoint, bucket: input.bucket, username: input.username,
    secretCiphertext: await sealSecret(pepper, input.secret), deletePolicy: input.deletePolicy,
    schedule: input.schedule, name: input.name, remotePath: input.remotePath, retentionCount: input.retentionCount,
  });
}

/** 更新目标补丁归一：仅接受出现且类型正确的字段（与创建同一套边界）；secret 保持明文待密封。 */
function normalizeTargetPatch(patch: TargetInput): Partial<Omit<NormalizedTargetInput, "secret">> & { secret?: string } {
  return {
    ...(typeof patch.name === "string" ? { name: patch.name.slice(0, 100) } : {}),
    ...(typeof patch.endpoint === "string" ? { endpoint: patch.endpoint.slice(0, 500) } : {}),
    ...(typeof patch.bucket === "string" ? { bucket: patch.bucket } : {}),
    ...(typeof patch.username === "string" ? { username: patch.username } : {}),
    ...(typeof patch.secret === "string" && patch.secret ? { secret: patch.secret } : {}),
    ...(patch.schedule === "daily" || patch.schedule === "weekly" || patch.schedule === "manual" ? { schedule: patch.schedule } : {}),
    ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
    ...(typeof patch.remotePath === "string" ? { remotePath: patch.remotePath.trim().slice(0, 300) || "menote" } : {}),
    ...(typeof patch.retentionCount === "number" && Number.isInteger(patch.retentionCount) ? { retentionCount: Math.max(0, Math.min(1000, patch.retentionCount)) } : {}),
  };
}

/** 更新目标（secret 出现时重新密封）；失败向上抛出（路由映射 503）。 */
export async function applyTargetPatch(db: D1Database, userId: string, pepper: string, id: string, patch: TargetInput): Promise<void> {
  const { secret, ...fields } = normalizeTargetPatch(patch);
  await updateTarget(db, userId, id, {
    ...fields,
    ...(secret ? { secretCiphertext: await sealSecret(pepper, secret) } : {}),
  });
}

export async function getTargetForUser(db: D1Database, userId: string, id: string): Promise<Target | null> {
  return getTarget(db, userId, id);
}

export async function listTargetsForUser(db: D1Database, userId: string) {
  return listTargets(db, userId);
}

export async function deleteTargetForUser(db: D1Database, userId: string, id: string): Promise<void> {
  await deleteTarget(db, userId, id);
}

/** 目标凭据解封（C-7 显式查看/推送前置）；密封数据缺失按空串处理，解封失败向上抛出。 */
export async function openTargetSecret(pepper: string, target: Target): Promise<string> {
  return openSecret(pepper, target.secretCiphertext ?? "");
}

/** 目标行 → 远端协议参数（RemoteTarget；与 db 行字段解耦）。 */
export function toRemoteTarget(target: Target, secret: string): RemoteTarget {
  return {
    kind: target.kind === "s3" ? "s3" : "webdav", endpoint: target.endpoint ?? "", bucket: target.bucket,
    username: target.username, secret, remotePath: target.remotePath, retentionCount: target.retentionCount,
  };
}

/** 未保存目标的连通性测试（FR-BAK-8 创建前验证）；输入非法返回 null（路由映射 400）。 */
export async function testUnsavedTarget(
  input: { kind: unknown; endpoint: unknown; secret: unknown; bucket?: unknown; username?: unknown; remotePath?: unknown },
) {
  if ((input.kind !== "webdav" && input.kind !== "s3") || typeof input.endpoint !== "string" || typeof input.secret !== "string") return null;
  return testRemoteTarget({
    kind: input.kind, endpoint: input.endpoint,
    bucket: typeof input.bucket === "string" ? input.bucket : null,
    username: typeof input.username === "string" ? input.username : null, secret: input.secret,
    remotePath: typeof input.remotePath === "string" ? input.remotePath : "menote", retentionCount: 0,
  });
}

export type TargetPushResult =
  | { ok: true; shards: number; backupId: string }
  | { ok: false; error: string }
  | { status: "target_missing_or_disabled" }
  | { status: "unavailable" };

/** 推送一次（FR-BAK-2，手动与定时同一流程）：解封 → 快照推送 → 落推送结果。
 *  目标缺失/停用与解封失败同样落结果记录后返回，由调用方映射 HTTP 状态：
 *  pushBackup 的远端失败 = ok:false（502）；未预期异常 = unavailable（503）。 */
export async function runTargetPushById(
  ctx: { db: D1Database; userId: string; bucket: R2Bucket }, id: string, pepper: string,
): Promise<TargetPushResult> {
  const target = await getTarget(ctx.db, ctx.userId, id);
  if (!target || !target.enabled) return { status: "target_missing_or_disabled" };
  try {
    const secret = await openSecret(pepper, target.secretCiphertext ?? "");
    const result = await pushBackup({ db: ctx.db, userId: ctx.userId, bucket: ctx.bucket }, toRemoteTarget(target, secret));
    const pushedAt = Date.now();
    await recordTargetResult(ctx.db, ctx.userId, target.id, result.ok ? `ok:${new Date(pushedAt).toISOString()}:${result.shards} 分片` : `失败:${result.error}`, result.ok ? pushedAt : null);
    return result;
  } catch (error) {
    await recordTargetResult(ctx.db, ctx.userId, target.id, `失败:${String(error).slice(0, 200)}`);
    return { status: "unavailable" };
  }
}
