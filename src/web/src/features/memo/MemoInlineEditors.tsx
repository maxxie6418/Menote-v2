import { useState } from "react";
import { ArrowUp, Pencil, Quote, Trash2 } from "lucide-react";
import type { Item, MemoComment } from "@menote/shared";
import { MarkdownView } from "../markdown";
import { addMemoComment, createQuoteMemo, deleteMemoComment, editMemoComment } from "../../services/memoService";
import { useMemoComments } from "../../services/contentHooks";

/** 卡片内评论：列表、改一条、写一条，都在原位，不另开窗口。 */
export function MemoCommentPanel({ userId, memoId }: { userId: string; memoId: string }) {
  const comments = useMemoComments(userId, memoId);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<MemoComment | null>(null);
  const [editValue, setEditValue] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <div className="mn-memo-inline-editor" aria-label="评论">
      <form className="mn-memo-comment-compose" onSubmit={(event) => {
        event.preventDefault();
        const content = draft.trim();
        if (!content) return;
        setSaving(true);
        setActionError(null);
        void addMemoComment(userId, memoId, content)
          .then(() => setDraft(""))
          .catch(() => setActionError("评论未能保存，请检查本地存储后重试。"))
          .finally(() => setSaving(false));
      }}>
        <textarea autoFocus aria-label="写下评论" placeholder="写下你的评论…" value={draft} onChange={(event) => setDraft(event.target.value)} />
        <button type="submit" aria-label="发送评论" disabled={!draft.trim() || saving}><ArrowUp /></button>
      </form>
      {actionError && <p className="mn-memo-action-error" role="alert">{actionError}</p>}
      <div className="mn-memo-comment-list">
        {comments.map((comment) => (
          <article className="mn-memo-comment" key={comment.id}>
            <div className="mn-memo-comment-head">
              <time>{new Date(comment.createdAt).toLocaleString()}</time>
              {comment.updatedAt > comment.createdAt && <span>已编辑</span>}
              <span className="mn-memo-comment-actions">
                <button type="button" aria-label="编辑评论" onClick={() => { setEditing(comment); setEditValue(comment.content); }}><Pencil /></button>
                <button type="button" aria-label="删除评论" onClick={() => {
                  setActionError(null);
                  void deleteMemoComment(userId, comment.id).catch(() => setActionError("评论未能删除，请重试。"));
                }}><Trash2 /></button>
              </span>
            </div>
            {editing?.id === comment.id ? (
              <div className="mn-memo-comment-edit">
                <textarea autoFocus aria-label="编辑评论" value={editValue} onChange={(event) => setEditValue(event.target.value)} />
                <div>
                  <button type="button" onClick={() => setEditing(null)}>取消</button>
                  <button type="button" disabled={saving} onClick={() => {
                    setSaving(true);
                    setActionError(null);
                    void editMemoComment(userId, comment.id, editValue)
                      .then(() => setEditing(null))
                      .catch(() => setActionError("评论未能保存，请重试。"))
                      .finally(() => setSaving(false));
                  }}>保存</button>
                </div>
              </div>
            ) : <MarkdownView markdown={comment.content} className="mn-memo-comment-content" />}
          </article>
        ))}
        {comments.length === 0 && <p className="mn-memo-comments-empty">还没有评论。</p>}
      </div>
    </div>
  );
}

/** 卡片内引述：原文快照和输入框一起出现，发布后才离开这张卡片。 */
export function MemoQuotePanel({ userId, memo, onCreated, onCancel }: {
  userId: string;
  memo: Item;
  onCreated: (item: Item) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <div className="mn-memo-inline-editor" aria-label="引述">
      <textarea className="mn-memo-quote-input" autoFocus aria-label="引述正文" placeholder="写下你的引述…" value={draft} onChange={(event) => setDraft(event.target.value)} />
      <aside className="mn-memo-quote-snapshot">
        <div className="mn-memo-quote-head"><span><Quote /> 引自 {new Date(memo.createdAt).toLocaleString()}</span></div>
        {memo.content.scope === "plain" && <MarkdownView markdown={memo.content.markdown} className="mn-memo-quote-content" />}
      </aside>
      <footer className="mn-memo-quote-footer">
        <span>发布即冻结原文</span>
        <button type="button" onClick={onCancel}>取消</button>
        <button type="button" disabled={!draft.trim() || saving} onClick={() => {
          setSaving(true);
          void createQuoteMemo(userId, memo, draft.trim()).then(onCreated).finally(() => setSaving(false));
        }}>发布</button>
      </footer>
    </div>
  );
}
