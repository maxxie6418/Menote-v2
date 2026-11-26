import { recordJobRun } from "../db/jobs";

/** 定时任务注册表（G3 框架）。实际任务在 G9（备份推送）与 G10（清理）接入实现；
 *  Worker 定时入口只分派给已就绪的 schema，迁移由 HTTP 就绪流程触发。 */
export interface ScheduledJob {
  name: string;
  description: string;
  enabled: boolean;
  run: (env: Env, ctx: TaskContext, now: number) => Promise<void> | void;
}

export const scheduledJobs: ScheduledJob[] = [
  {
    name: "backup_push",
    description: "备份快照推送（daily/weekly 到期目标，G9）",
    enabled: true,
    run: async (env) => {
      const { listDueTargets } = await import("../db/backup");
      const { runTargetPushById } = await import("../services/backupTargetService");
      let failed = 0;
      for (const target of await listDueTargets(env.DB, Date.now())) {
        try {
          const result = await runTargetPushById(
            { db: env.DB, userId: target.user_id, bucket: env.BUCKET }, target.id, Reflect.get(env, "AUTH_PEPPER") as string,
          );
          if ("ok" in result ? !result.ok : result.status === "unavailable") failed++;
        } catch (error) {
          failed++;
          // 单目标失败不阻断其余目标（推送结果已尽量由服务层落库）。
          console.error("backup_push target failed:", target.id, error);
        }
      }
      if (failed) throw new Error(`${failed} 个备份目标推送失败`);
    },
  },
  {
    name: "raindrop_pull",
    description: "Raindrop 收藏定时拉取（FR-EXT-3，TP9；插件开关关闭/未到期/无令牌的绑定逐个跳过）",
    enabled: true,
    run: async (env) => {
      const { runScheduledPulls } = await import("../services/raindropService");
      await runScheduledPulls(env);
    },
  },
  {
    name: "cleanup",
    description: "软删与日志 90 天清理，孤儿附件 30 天后回收",
    enabled: true,
    run: async (env, _ctx, now) => {
      const {
        listUsers, listExpiredSoftDeleted, purgeItemsWithWraps,
        purgeSyncLogBefore, purgeSyncOperationsBefore, purgeJobRunsBefore,
      } = await import("../db/cleanup");
      const { failStaleAiTasks, deleteStaleAiTasks } = await import("../db/ai");
      const { cleanupAttachments } = await import("../services/attachmentService");
      const DAY = 86_400_000;
      const cutoff = now - 90 * DAY;
      // 软删本体 / sync_log / sync_operations：90 天保留期（G2 定稿）。
      for (const user of await listUsers(env.DB)) {
        const expired = await listExpiredSoftDeleted(env.DB, user.id, cutoff);
        if (expired.length > 0) await purgeItemsWithWraps(env.DB, user.id, expired, cutoff);
        await purgeSyncLogBefore(env.DB, user.id, cutoff);
        await purgeSyncOperationsBefore(env.DB, user.id, cutoff);
      }
      await purgeJobRunsBefore(env.DB, cutoff);
      // TP8：AI 任务超时兜底（1 小时）与完成留痕 30 天清理。
      await failStaleAiTasks(env.DB, now - 3_600_000, now);
      await deleteStaleAiTasks(env.DB, now - 30 * DAY);
      await cleanupAttachments({ db: env.DB, bucket: env.BUCKET }, now);
    },
  },
];

/** 逐任务执行：失败互不影响、逐条落 job_runs；记录失败只吞掉，不影响调度 outcome。 */
export async function dispatchScheduled(
  env: Env, ctx: TaskContext, now = Date.now(), jobs: readonly ScheduledJob[] = scheduledJobs,
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
