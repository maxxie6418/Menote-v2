import type { MemoComment } from "@menote/shared";

export function rowToMemoComment(row: Record<string, unknown>, userIdOverride?: string): MemoComment {
  return {
    id: String(row.id), userId: userIdOverride ?? String(row.user_id), memoId: String(row.memo_id),
    parentId: row.parent_id === null || row.parent_id === undefined ? null : String(row.parent_id),
    content: String(row.content_markdown), rev: Number(row.rev),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    deletedAt: row.deleted_at === null || row.deleted_at === undefined ? null : Number(row.deleted_at),
  };
}

export async function readMemoComments(db: D1Database, userId: string, ids: string[]): Promise<MemoComment[]> {
  if (ids.length === 0) return [];
  const results: MemoComment[] = [];
  for (let index = 0; index < ids.length; index += 90) {
    const chunk = ids.slice(index, index + 90);
    const rows = await db.prepare(
      `SELECT * FROM memo_comments WHERE user_id = ? AND id IN (${chunk.map(() => "?").join(",")}) AND deleted_at IS NULL`,
    ).bind(userId, ...chunk).all<Record<string, unknown>>();
    results.push(...rows.results.map((row) => rowToMemoComment(row)));
  }
  return results;
}

export async function readAllMemoComments(db: D1Database, userId: string): Promise<MemoComment[]> {
  const rows = await db.prepare("SELECT * FROM memo_comments WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at, id")
    .bind(userId).all<Record<string, unknown>>();
  return rows.results.map((row) => rowToMemoComment(row));
}

export async function readMemoCommentState(db: D1Database, userId: string, id: string) {
  return db.prepare("SELECT rev, updated_at, deleted_at FROM memo_comments WHERE user_id = ? AND id = ?")
    .bind(userId, id).first<{ rev: number; updated_at: number; deleted_at: number | null }>();
}

/** 父评论结构状态（upsert 预检与恢复预检共用，口径与 0038 触发器一致）。 */
export async function readMemoCommentParentState(db: D1Database, userId: string, id: string) {
  return db.prepare("SELECT memo_id, parent_id, deleted_at FROM memo_comments WHERE user_id = ? AND id = ?")
    .bind(userId, id).first<{ memo_id: string; parent_id: string | null; deleted_at: number | null }>();
}

/** 根评论下的活回复（删除级联用；回复不可再有子级，非根调用返回空）。 */
export async function readMemoCommentChildren(db: D1Database, userId: string, rootId: string) {
  const rows = await db.prepare(
    "SELECT id, rev FROM memo_comments WHERE user_id = ? AND parent_id = ? AND deleted_at IS NULL",
  ).bind(userId, rootId).all<{ id: string; rev: number }>();
  return rows.results;
}

export async function readMemoOwnerState(db: D1Database, userId: string, memoId: string) {
  return db.prepare("SELECT type, deleted_at FROM items WHERE user_id = ? AND id = ?")
    .bind(userId, memoId).first<{ type: string; deleted_at: number | null }>();
}

export function upsertMemoCommentStatement(db: D1Database, comment: MemoComment): D1PreparedStatement {
  return db.prepare(
    "INSERT INTO memo_comments (id, user_id, memo_id, parent_id, content_markdown, rev, created_at, updated_at, deleted_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, id) DO UPDATE SET " +
      "memo_id = excluded.memo_id, parent_id = excluded.parent_id, content_markdown = excluded.content_markdown, " +
      "rev = MAX(memo_comments.rev, excluded.rev), updated_at = excluded.updated_at, deleted_at = excluded.deleted_at",
  ).bind(comment.id, comment.userId, comment.memoId, comment.parentId ?? null, comment.content, comment.rev, comment.createdAt, comment.updatedAt, comment.deletedAt);
}

export async function upsertMemoComment(db: D1Database, comment: MemoComment): Promise<void> {
  await upsertMemoCommentStatement(db, comment).run();
}

/** 墓碑一条评论（删除根评论时对其回复级联使用）；UPDATE 不触发父校验触发器。 */
export function markMemoCommentDeletedStatement(db: D1Database, userId: string, id: string, deletedAt: number): D1PreparedStatement {
  return db.prepare(
    "UPDATE memo_comments SET deleted_at = ?, updated_at = ?, rev = rev + 1 WHERE user_id = ? AND id = ? AND deleted_at IS NULL",
  ).bind(deletedAt, deletedAt, userId, id);
}
