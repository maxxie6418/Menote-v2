/** 定时任务执行记录（G3 调度框架）。SQL 只在 db 层。 */

export interface JobRunRow {
  id: number;
  name: string;
  startedAt: number;
  finishedAt: number;
  status: "ok" | "failed";
  detail: string | null;
}

export async function recordJobRun(
  db: D1Database, name: string, startedAt: number, finishedAt: number,
  status: "ok" | "failed", detail: string | null,
): Promise<void> {
  await db.prepare(
    "INSERT INTO job_runs (name, started_at, finished_at, status, detail) VALUES (?, ?, ?, ?, ?)",
  ).bind(name, startedAt, finishedAt, status, detail).run();
}

export async function readRecentJobRuns(db: D1Database, limit: number): Promise<JobRunRow[]> {
  const rows = await db.prepare(
    "SELECT id, name, started_at, finished_at, status, detail FROM job_runs ORDER BY id DESC LIMIT ?",
  ).bind(Math.max(1, Math.min(limit, 200))).all<{
    id: number; name: string; started_at: number; finished_at: number; status: string; detail: string | null;
  }>();
  return rows.results.map((row) => ({
    id: row.id, name: row.name, startedAt: row.started_at, finishedAt: row.finished_at,
    status: row.status === "failed" ? "failed" : "ok", detail: row.detail,
  }));
}
