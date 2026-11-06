import type { Item, MemoComment, MemoQuote } from "@menote/shared";
import { localDb } from "../db/localDb";
import { getItem } from "../db/itemsRepo";
import { getMemoComment, listMemoComments, putMemoComment } from "../db/memoCommentsRepo";
import { notifyLocalChange } from "../lib/broadcast";
import { newId } from "../lib/hash";
import { toOutboxRow } from "../db/outboxRepo";
import { enqueueWrite } from "./contentShared";
import { createMemo } from "./contentService";

export { listMemoComments };

export function createQuoteMemo(userId: string, source: Item, markdown: string, tags: string[] = source.tags): Promise<Item> {
  if (source.type !== "memo" || source.deletedAt !== null) throw new Error("memo_quote_source_unavailable");
  const memoQuote: MemoQuote = {
    sourceMemoId: source.id,
    sourceCreatedAt: source.createdAt,
    snapshot: source.content.markdown,
  };
  return createMemo(userId, markdown, tags, memoQuote);
}

export function addMemoComment(userId: string, memoId: string, content: string, parentId: string | null = null): Promise<MemoComment> {
  return enqueueWrite(async () => {
    const memo = await getItem(userId, memoId);
    if (!memo || memo.type !== "memo" || memo.deletedAt !== null) throw new Error("memo_unavailable");
    if (parentId) {
      const parent = await getMemoComment(userId, parentId);
      if (!parent || parent.memoId !== memoId || parent.parentId || parent.deletedAt !== null) throw new Error("memo_comment_parent_unavailable");
    }
    const now = Date.now();
    const comment: MemoComment = { id: newId(), userId, memoId, parentId, content, rev: 1, createdAt: now, updatedAt: now, deletedAt: null };
    await localDb.transaction("rw", localDb.memoComments, localDb.outbox, async () => {
      await putMemoComment(comment);
      await localDb.outbox.add(toOutboxRow({
        operationId: newId(), userId, entityId: comment.id, entity: "memo_comment", action: "upsert",
        baseRev: 0, baseMetaRev: 0, payload: { comment },
      }, now));
    });
    notifyLocalChange();
    return comment;
  });
}

export function editMemoComment(userId: string, commentId: string, content: string): Promise<MemoComment> {
  return enqueueWrite(async () => {
    const current = await getMemoComment(userId, commentId);
    if (!current || current.deletedAt !== null) throw new Error("memo_comment_unavailable");
    const root = await getItem(userId, current.memoId);
    if (!root || root.type !== "memo" || root.deletedAt !== null) throw new Error("memo_unavailable");
    const next = { ...current, content, rev: current.rev + 1, updatedAt: Date.now() };
    await localDb.transaction("rw", localDb.memoComments, localDb.outbox, async () => {
      await putMemoComment(next);
      await localDb.outbox.add(toOutboxRow({
        operationId: newId(), userId, entityId: next.id, entity: "memo_comment", action: "upsert",
        baseRev: current.rev, baseMetaRev: 0, payload: { comment: next },
      }, next.updatedAt));
    });
    notifyLocalChange();
    return next;
  });
}

export function deleteMemoComment(userId: string, commentId: string): Promise<void> {
  return enqueueWrite(async () => {
    const current = await getMemoComment(userId, commentId);
    if (!current || current.deletedAt !== null) return;
    const now = Date.now();
    const targets = current.parentId ? [current] : [current, ...(await listMemoComments(userId, current.memoId)).filter((row) => row.parentId === current.id)];
    await localDb.transaction("rw", localDb.memoComments, localDb.outbox, async () => {
      for (const target of targets) {
        const next = { ...target, rev: target.rev + 1, updatedAt: now, deletedAt: now };
        await putMemoComment(next);
        await localDb.outbox.add(toOutboxRow({
          operationId: newId(), userId, entityId: next.id, entity: "memo_comment", action: "delete",
          baseRev: target.rev, baseMetaRev: 0, payload: { comment: next },
        }, now));
      }
    });
    notifyLocalChange();
  });
}
