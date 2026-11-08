import Dexie from "dexie";
import type { MemoComment } from "@menote/shared";
import { localDb } from "./localDb";

export async function getMemoComment(userId: string, id: string): Promise<MemoComment | undefined> {
  const row = await localDb.memoComments.get(id);
  return row?.userId === userId ? { ...row, parentId: row.parentId ?? null } : undefined;
}

export async function listMemoComments(userId: string, memoId: string): Promise<MemoComment[]> {
  const rows = await localDb.memoComments.where("[userId+memoId+createdAt]").between(
    [userId, memoId, Dexie.minKey], [userId, memoId, Dexie.maxKey], true, true,
  ).toArray();
  return rows.filter((row) => row.deletedAt === null).map((row) => ({ ...row, parentId: row.parentId ?? null })).sort((a, b) => a.createdAt - b.createdAt);
}

export async function listAllMemoComments(userId: string): Promise<MemoComment[]> {
  return (await localDb.memoComments.where("userId").equals(userId).toArray()).map((row) => ({ ...row, parentId: row.parentId ?? null }));
}

export async function putMemoComment(comment: MemoComment): Promise<void> {
  await localDb.memoComments.put(comment);
}

export async function bulkPutMemoComments(comments: MemoComment[]): Promise<void> {
  if (comments.length > 0) await localDb.memoComments.bulkPut(comments);
}

export async function deleteMemoComments(ids: string[]): Promise<void> {
  if (ids.length > 0) await localDb.memoComments.bulkDelete(ids);
}

