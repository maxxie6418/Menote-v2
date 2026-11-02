import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { ArrowUp, Pencil, Quote, Trash2, X } from "lucide-react";
import type { Item, MemoComment } from "@menote/shared";
import { MarkdownView } from "../markdown";
import { addMemoComment, createQuoteMemo, deleteMemoComment, editMemoComment } from "../../services/memoService";
import { useMemoComments } from "../../services/contentHooks";

interface DialogProps {
  onClose: () => void;
}

export function MemoDetailDialog({ userId, memo, onClose }: DialogProps & { userId: string; memo: Item }) {
  const comments = useMemoComments(userId, memo.id);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<MemoComment | null>(null);
  const [editValue, setEditValue] = useState("");

  const closeOnBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };
  const onDialogKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
  };

  return (
    <div className="mn-memo-modal-scrim" onMouseDown={closeOnBackdrop} onKeyDown={onDialogKey}>
      <section className="mn-memo-modal" role="dialog" aria-modal="true" aria-labelledby="mn-memo-detail-title" autoFocus tabIndex={-1}>
        <header className="mn-memo-modal-head">
          <span id="mn-memo-detail-title">MEMO · {new Date(memo.createdAt).toLocaleString()}</span>
          <button type="button" aria-label="关闭" onClick={onClose}><X /></button>
        </header>
        <div className="mn-memo-modal-body">
          {memo.content.scope === "plain" && <MarkdownView markdown={memo.content.markdown} className="mn-memo-dialog-source" />}
          {memo.tags.length > 0 && <div className="mn-memo-tags">{memo.tags.map((tag) => <span className="mn-memo-tag" key={tag}>#{tag}</span>)}</div>}
          <div className="mn-memo-comments-title">{comments.length} 条评论</div>
          <div className="mn-memo-comment-list">
            {comments.map((comment) => (
              <article className="mn-memo-comment" key={comment.id}>
                <div className="mn-memo-comment-head">
                  <time>{new Date(comment.createdAt).toLocaleString()}</time>
                  {comment.updatedAt > comment.createdAt && <span>已编辑</span>}
                  <span className="mn-memo-comment-actions">
                    <button type="button" aria-label="编辑评论" onClick={() => { setEditing(comment); setEditValue(comment.content); }}><Pencil /></button>
                    <button type="button" aria-label="删除评论" onClick={() => void deleteMemoComment(userId, comment.id)}><Trash2 /></button>
                  </span>
                </div>
                {editing?.id === comment.id ? (
                  <div className="mn-memo-comment-edit">
                    <textarea autoFocus aria-label="编辑评论" value={editValue} onChange={(event) => setEditValue(event.target.value)} />
                    <div><button type="button" onClick={() => setEditing(null)}>取消</button><button type="button" onClick={() => { void editMemoComment(userId, comment.id, editValue).then(() => setEditing(null)); }}>保存</button></div>
                  </div>
                ) : <MarkdownView markdown={comment.content} className="mn-memo-comment-content" />}
              </article>
            ))}
            {comments.length === 0 && <p className="mn-memo-comments-empty">还没有评论，过段时间再回来补充也可以。</p>}
          </div>
        </div>
        <form className="mn-memo-comment-compose" onSubmit={(event) => {
          event.preventDefault();
          const content = draft.trim();
          if (!content) return;
          void addMemoComment(userId, memo.id, content).then(() => setDraft(""));
        }}>
          <textarea aria-label="写下评论" placeholder="写下你的评论…" value={draft} onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" aria-label="发送评论" disabled={!draft.trim()}><ArrowUp /></button>
        </form>
      </section>
    </div>
  );
}

export function MemoQuoteDialog({ userId, memo, onClose, onCreated }: DialogProps & { userId: string; memo: Item; onCreated: (item: Item) => void }) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const closeOnBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };
  const onDialogKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
  };
  return (
    <div className="mn-memo-modal-scrim" onMouseDown={closeOnBackdrop} onKeyDown={onDialogKey}>
      <section className="mn-memo-modal mn-memo-quote-modal" role="dialog" aria-modal="true" aria-labelledby="mn-memo-quote-title" autoFocus tabIndex={-1}>
        <header className="mn-memo-modal-head">
          <span id="mn-memo-quote-title">引述 · 新发言</span>
          <button type="button" aria-label="关闭" onClick={onClose}><X /></button>
        </header>
        <div className="mn-memo-modal-body">
          <textarea className="mn-memo-quote-input" autoFocus aria-label="引述正文" placeholder="写下你的引述…" value={draft} onChange={(event) => setDraft(event.target.value)} />
          <aside className="mn-memo-quote-snapshot">
            <div><Quote /> 引自 {new Date(memo.createdAt).toLocaleString()} · 原文快照</div>
            {memo.content.scope === "plain" && <MarkdownView markdown={memo.content.markdown} className="mn-memo-quote-content" />}
          </aside>
        </div>
        <footer className="mn-memo-quote-footer">
          <span>发布即冻结 · 原文后续编辑不影响本条</span>
          <button type="button" disabled={!draft.trim() || saving} onClick={() => {
            setSaving(true);
            void createQuoteMemo(userId, memo, draft.trim()).then((item) => { onCreated(item); onClose(); }).finally(() => setSaving(false));
          }}>发布</button>
        </footer>
      </section>
    </div>
  );
}
