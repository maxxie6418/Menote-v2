import type { MemoComment } from "@menote/shared";

export function rowToMemoComment(row: Record<string, unknown>, userIdOverride?: string): MemoComment {
  return {
    id: String(row.id), userId: userIdOverride ?? String(row.user_id), memoId: String(row.memo_id),
    content: String(row.content_markdown), rev: Number(row.rev),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    deletedAt: row.deleted_at === null || row.deleted_at === undefined ? null : Number(row.deleted_at),
  };
}

export async function readMemoComments(db: D1Database, userId: string, ids: string[]): Promise<MemoComment[]> {
  if (ids.length === 0) return [];
  const rows = await db.prepare(
    `SELECT * FROM memo_comments WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")}) AND deleted_at IS NULL`,
  ).bind(userId, ...ids).all<Record<string, unknown>>();
  return rows.results.map(rowToMemoComment);
}

export async function readAllMemoComments(db: D1Database, userId: string): Promise<MemoComment[]> {
  const rows = await db.prepare("SELECT * FROM memo_comments WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at, id")
    .bind(userId).all<Record<string, unknown>>();
  return rows.results.map(rowToMemoComment);
}

export async function readMemoCommentState(db: D1Database, userId: string, id: string) {
  return db.prepare("SELECT rev, updated_at, deleted_at FROM memo_comments WHERE user_id = ? AND id = ?")
    .bind(userId, id).first<{ rev: number; updated_at: number; deleted_at: number | null }>();
}

export async function readMemoOwnerState(db: D1Database, userId: string, memoId: string) {
  return db.prepare("SELECT type, deleted_at FROM items WHERE user_id = ? AND id = ?")
    .bind(userId, memoId).first<{ type: string; deleted_at: number | null }>();
}

export async function upsertMemoComment(db: D1Database, comment: MemoComment): Promise<void> {
  await db.prepare(
    `INSERT INTO memo_comments (id, user_id, memo_id, content_markdown, rev, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, id) DO UPDATE SET memo_id = excluded.memo_id, content_markdown = excluded.content_markdown,
       rev = MAX(memo_comments.rev, excluded.rev), updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`,
  ).bind(comment.id, comment.userId, comment.memoId, comment.content, comment.rev, comment.createdAt, comment.updatedAt, comment.deletedAt).run();
}

export async function markMemoCommentDeleted(db: D1Database, userId: string, id: string, deletedAt: number): Promise<void> {
  await db.prepare("UPDATE memo_comments SET deleted_at = ?, updated_at = ?, rev = rev + 1 WHERE user_id = ? AND id = ?")
    .bind(deletedAt, deletedAt, userId, id).run();
}
