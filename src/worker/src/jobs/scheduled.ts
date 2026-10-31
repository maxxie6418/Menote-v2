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
    description: "备份分片推送与断点续传（G9 接入）",
    enabled: false,
    run: () => {},
  },
  {
    name: "cleanup",
    description: "孤儿附件 30 天、墓碑/运行记录保留期清理（G10 接入）",
    enabled: false,
    run: () => {},
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
