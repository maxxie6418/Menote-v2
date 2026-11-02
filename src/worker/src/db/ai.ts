import type { AiTaskKind, AiTaskStatus } from "@menote/shared";

export interface AiTaskRow {
  id: string;
  userId: string;
  itemId: string;
  kind: AiTaskKind;
  contentHash: string;
  model: string;
  status: AiTaskStatus;
  resultJson: string | null;
  error: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: number;
  updatedAt: number;
}

interface AiTaskSqlRow {
  id: string; user_id: string; item_id: string; kind: string; content_hash: string; model: string;
  status: string; result_json: string | null; error: string | null;
  input_tokens: number | null; output_tokens: number | null; created_at: number; updated_at: number;
}

function rowToTask(row: AiTaskSqlRow): AiTaskRow {
  return {
    id: row.id, userId: row.user_id, itemId: row.item_id, kind: row.kind as AiTaskKind,
    contentHash: row.content_hash, model: row.model, status: row.status as AiTaskStatus,
    resultJson: row.result_json, error: row.error, inputTokens: row.input_tokens, outputTokens: row.output_tokens,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

const TASK_COLUMNS = "id, user_id, item_id, kind, content_hash, model, status, result_json, error, input_tokens, output_tokens, created_at, updated_at";

export async function insertAiTask(db: D1Database, row: AiTaskRow): Promise<void> {
  await db.prepare(
    `INSERT INTO ai_tasks (id, user_id, item_id, kind, content_hash, model, status, result_json, error, input_tokens, output_tokens, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(row.id, row.userId, row.itemId, row.kind, row.contentHash, row.model, row.status,
    row.resultJson, row.error, row.inputTokens, row.outputTokens, row.createdAt, row.updatedAt).run();
}

export async function readAiTask(db: D1Database, userId: string, id: string): Promise<AiTaskRow | null> {
  const row = await db.prepare(`SELECT ${TASK_COLUMNS} FROM ai_tasks WHERE id = ? AND user_id = ?`)
    .bind(id, userId).first<AiTaskSqlRow>();
  return row ? rowToTask(row) : null;
}

export async function findReusableAiTask(db: D1Database, userId: string, itemId: string, kind: string, contentHash: string): Promise<AiTaskRow | null> {
  const row = await db.prepare(
    `SELECT ${TASK_COLUMNS} FROM ai_tasks WHERE user_id = ? AND item_id = ? AND kind = ? AND content_hash = ? AND status = 'done'
     ORDER BY updated_at DESC LIMIT 1`,
  ).bind(userId, itemId, kind, contentHash).first<AiTaskSqlRow>();
  return row ? rowToTask(row) : null;
}

export async function findActiveAiTask(db: D1Database, userId: string, itemId: string, kind: string, contentHash: string): Promise<AiTaskRow | null> {
  const row = await db.prepare(
    `SELECT ${TASK_COLUMNS} FROM ai_tasks WHERE user_id = ? AND item_id = ? AND kind = ? AND content_hash = ? AND status IN ('queued', 'running')
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(userId, itemId, kind, contentHash).first<AiTaskSqlRow>();
  return row ? rowToTask(row) : null;
}

export async function updateAiTaskOutcome(
  db: D1Database, id: string, status: AiTaskStatus,
  patch: { resultJson?: string; error?: string; inputTokens?: number; outputTokens?: number }, now: number,
): Promise<void> {
  await db.prepare(
    `UPDATE ai_tasks SET status = ?, result_json = ?, error = ?, input_tokens = ?, output_tokens = ?, updated_at = ? WHERE id = ?`,
  ).bind(status, patch.resultJson ?? null, patch.error ?? null, patch.inputTokens ?? null, patch.outputTokens ?? null, now, id).run();
}

/** 提交前的条目守卫：归属与加密排除在 SQL 侧一次判定（加密条目不进入云端 AI）。 */
export async function readAiEligibleItem(db: D1Database, userId: string, itemId: string): Promise<{ type: string } | null> {
  const row = await db.prepare(
    "SELECT type FROM items WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND enc_self = 0 AND in_enc_space = 0",
  ).bind(itemId, userId).first<{ type: string }>();
  return row ?? null;
}

export async function readAiUsage(db: D1Database, userId: string, day: string): Promise<{ calls: number; inputTokens: number; outputTokens: number }> {
  const row = await db.prepare("SELECT calls, input_tokens, output_tokens FROM ai_usage_daily WHERE user_id = ? AND day = ?")
    .bind(userId, day).first<{ calls: number; input_tokens: number; output_tokens: number }>();
  return row ? { calls: row.calls, inputTokens: row.input_tokens, outputTokens: row.output_tokens } : { calls: 0, inputTokens: 0, outputTokens: 0 };
}

export async function addAiUsage(
  db: D1Database, userId: string, day: string, usage: { calls: number; inputTokens: number; outputTokens: number },
): Promise<void> {
  await db.prepare(
    `INSERT INTO ai_usage_daily (user_id, day, calls, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, day) DO UPDATE SET calls = calls + excluded.calls,
       input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens`,
  ).bind(userId, day, usage.calls, usage.inputTokens, usage.outputTokens).run();
}

/** 任务留痕清理（随 cleanup 任务调用）：done/failed 记录保留 30 天，进行中的不清理。 */
export async function deleteStaleAiTasks(db: D1Database, before: number): Promise<void> {
  await db.prepare("DELETE FROM ai_tasks WHERE updated_at < ? AND status IN ('done', 'failed')").bind(before).run();
}

/** 队列消息丢失时的兜底：超时仍 queued/running 的任务置为失败，避免前端无限轮询。 */
export async function failStaleAiTasks(db: D1Database, before: number, now: number): Promise<void> {
  await db.prepare(
    "UPDATE ai_tasks SET status = 'failed', error = '任务超时未完成', updated_at = ? WHERE updated_at < ? AND status IN ('queued', 'running')",
  ).bind(now, before).run();
}
