import { recordJobRun } from "../db/jobs";

/** 定时任务注册表（G3 框架）。实际任务在 G9（备份推送）与 G10（清理）接入实现；
 *  接入方自行确保 schema 就绪（复用 ensureSchemaReady 模式），调度器不自动迁移。 */
export interface ScheduledJob {
  name: string;
  description: string;
  enabled: boolean;
  run: (env: Env, ctx: ExecutionContext, now: number) => Promise<void> | void;
}

export const scheduledJobs: ScheduledJob[] = [
  {
    name: "backup_push",
    description: "备份快照推送（daily/weekly 到期目标，G9）",
    enabled: true,
    run: async (env) => {
      const { listDueTargets, recordTargetResult } = await import("../db/backup");
      const { pushBackup, openSecret } = await import("../services/backupService");
      const now = Date.now();
      for (const target of await listDueTargets(env.DB, now)) {
        try {
          const secret = await openSecret(Reflect.get(env, "AUTH_PEPPER") as string, target.secret_ciphertext ?? "");
          const result = await pushBackup(
            { db: env.DB, userId: target.user_id, bucket: env.BUCKET },
            { kind: target.kind === "s3" ? "s3" : "webdav", endpoint: target.endpoint ?? "", bucket: target.bucket, username: target.username, secret, remotePath: target.remote_path, retentionCount: target.retention_count },
          );
          const pushedAt = Date.now();
          const message = result.ok ? `ok:${new Date(pushedAt!).toISOString()}:${result.shards} 分片` : `失败:${result.error}`;
          await recordTargetResult(env.DB, target.user_id, target.id, message, pushedAt);
        } catch (error) {
          await recordTargetResult(env.DB, target.user_id, target.id, `失败:${String(error).slice(0, 200)}`, Date.now());
        }
      }
    },
  },
  {
    name: "cleanup",
    description: "孤儿附件 30 天真删、软删/日志 90 天保留期清理（G10）",
    enabled: true,
    run: async (env) => {
      const {
        listUsers, listExpiredSoftDeleted, purgeItemsWithWraps,
        purgeSyncLogBefore, purgeSyncOperationsBefore, purgeJobRunsBefore,
      } = await import("../db/cleanup");
      const { listExpiredOrphans, deleteAttachmentRow } = await import("../db/attachments");
      const now = Date.now();
      const DAY = 86_400_000;
      // 孤儿附件：归零观察 30 天后真删 R2 对象与元数据行（FR-SYNC-8）。
      for (const orphan of await listExpiredOrphans(env.DB, now - 30 * DAY)) {
        await env.BUCKET.delete(`${orphan.userId}/${orphan.sha256}`);
        await deleteAttachmentRow(env.DB, orphan.userId, orphan.sha256);
      }
      // 软删本体 / sync_log / sync_operations：90 天保留期（G2 定稿）。
      for (const user of await listUsers(env.DB)) {
        const expired = await listExpiredSoftDeleted(env.DB, user.id, now - 90 * DAY);
        if (expired.length > 0) await purgeItemsWithWraps(env.DB, user.id, expired);
        await purgeSyncLogBefore(env.DB, user.id, now - 90 * DAY);
        await purgeSyncOperationsBefore(env.DB, user.id, now - 90 * DAY);
      }
      await purgeJobRunsBefore(env.DB, now - 90 * DAY);
    },
  },
];

/** 逐任务执行：失败互不影响、逐条落 job_runs；记录失败只吞掉，不影响调度 outcome。 */
export async function dispatchScheduled(
  env: Env, ctx: ExecutionContext, now = Date.now(), jobs: readonly ScheduledJob[] = scheduledJobs,
): Promise<void> {
  if (!env.DB) return;
  for (const job of jobs) {
    if (!job.enabled) continue;
    const startedAt = Date.now();
    let status: "ok" | "failed" = "ok";
    let detail: string | null = null;
    try {
      await job.run(env, ctx, startedAt);
    } catch (error) {
      status = "failed";
      detail = String(error).slice(0, 500);
    }
    try {
      await recordJobRun(env.DB, job.name, startedAt, Date.now(), status, detail);
    } catch { /* 记录失败不改变本次调度结果。 */ }
  }
  void now;
}
