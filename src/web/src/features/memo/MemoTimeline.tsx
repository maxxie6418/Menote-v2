import { useState } from "react";
import { ChevronDown, MessageCircle, Repeat2, Star, Trash2 } from "lucide-react";
import type { Item } from "@menote/shared";
import { MarkdownView } from "../markdown";
import { setTaskCheckbox } from "../../lib/markdownTasks";
import { saveItemContent, saveItemMeta, softDeleteItem } from "../../services/contentService";
import { useMemoComments } from "../../services/contentHooks";
import { degradeMemoMarkdown, groupByDay, isPlainMemo, memoText, statusLabel } from "./memoView";

interface MemoTimelineProps {
  userId: string;
  memos: Item[];
  allMemos: Item[];
  onDragItem: (event: React.DragEvent, id: string) => void;
  onOpenMemo: (id: string) => void;
  onOpenSource: (id: string) => void;
  onQuote: (memo: Item) => void;
}

/** Memo 时间线（FR-MEMO-1）：默认视图、原位编辑（源文本，保存/失焦渲染）、任务复选框可点。 */
export function MemoTimeline({ userId, memos, allMemos, onDragItem, onOpenMemo, onOpenSource, onQuote }: MemoTimelineProps) {
  if (memos.length === 0) {
    return (
      <div className="mn-empty" role="status">
        <div>
          <p className="mn-empty-title">还没有 Memo</p>
          <p className="mn-empty-detail">用左侧输入框记一条，随手写的内容会出现在时间线里。</p>
        </div>
      </div>
    );
  }
  const groups = groupByDay(memos);
  return (
    <div className="mn-timeline" aria-label="Memo 时间线">
      {groups.map((group) => (
        <section key={group.label}>
          <p className="mn-mgroup">{group.label}</p>
          {group.memos.map((memo) => <MemoCard key={memo.id} userId={userId} memo={memo} allMemos={allMemos} onDragItem={onDragItem} onOpenMemo={onOpenMemo} onOpenSource={onOpenSource} onQuote={onQuote} />)}
        </section>
      ))}
    </div>
  );
}

function MemoCard({ userId, memo, allMemos, onDragItem, onOpenMemo, onOpenSource, onQuote }: { userId: string; memo: Item; allMemos: Item[]; onDragItem: (event: React.DragEvent, id: string) => void; onOpenMemo: (id: string) => void; onOpenSource: (id: string) => void; onQuote: (memo: Item) => void }) {
  const plain = isPlainMemo(memo);
  const source = memoText(memo);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(source);
  const [expanded, setExpanded] = useState(false);
  const comments = useMemoComments(userId, memo.id);
  const rendered = degradeMemoMarkdown(source);
  const status = statusLabel(memo.status);

  const commit = async () => {
    setEditing(false);
    if (plain && value !== source) await saveItemContent(userId, memo.id, value);
  };

  const toggleTask = async (ordinal: number, checked: boolean) => {
    if (!plain) return;
    const next = setTaskCheckbox(source, ordinal, checked);
    if (next !== source) await saveItemContent(userId, memo.id, next);
  };

  return (
    <article
      id={`memo-${memo.id}`}
      className={memo.createdAt >= Date.now() - 60_000 ? "mn-memo-card mn-memo-card-now" : "mn-memo-card"}
      draggable={!editing}
      onDragStart={(event) => onDragItem(event, memo.id)}
    >
      <div className="mn-memo-meta">
        <time>{new Date(memo.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</time>
        <span className="mn-memo-actions">
          {plain && !editing && (
            <button type="button" className="mn-minibtn" aria-label="编辑 Memo" onClick={() => { setValue(source); setEditing(true); }}>
              编辑
            </button>
          )}
          <button type="button" className="mn-minibtn" aria-label="移入回收站" onClick={() => void softDeleteItem(userId, memo.id)}>
            <Trash2 />
          </button>
        </span>
      </div>
      <div className="mn-memo-card-body">
        {editing ? (
          <textarea
            className="mn-memo-edit" autoFocus value={value} aria-label="编辑 Memo 源文本"
            onChange={(event) => setValue(event.target.value)}
            onBlur={() => void commit()}
            onKeyDown={(event) => {
              if (event.key === "Escape") { setValue(source); setEditing(false); }
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void commit();
            }}
          />
        ) : plain ? (
          <>
            <MarkdownView markdown={rendered.markdown} className="mn-memo-body" onToggleTask={(ordinal, checked) => void toggleTask(ordinal, checked)} />
            {rendered.raw.length > 0 && (
              <pre className="mn-memo-raw">{rendered.raw.join("\n")}</pre>
            )}
          </>
        ) : (
          <p className="mn-memo-locked">已加密</p>
        )}
        {plain && memo.tags.length > 0 && (
          <p className="mn-memo-tags">{memo.tags.map((tag) => <span key={tag} className="mn-memo-tag">#{tag}</span>)}</p>
        )}
        {status && <span className={`mn-memo-status ${memo.status}`}><i />{status}</span>}
        {memo.type === "memo" && plain && memo.memoQuote && (
          <aside className={`mn-memo-quote-snapshot ${allMemos.some((item) => item.id === memo.memoQuote?.sourceMemoId && item.deletedAt === null) ? "" : "is-source-deleted"}`}>
            <div className="mn-memo-quote-head"><span><Repeat2 /> 引自 {new Date(memo.memoQuote.sourceCreatedAt).toLocaleString()}</span>
              {allMemos.some((item) => item.id === memo.memoQuote?.sourceMemoId && item.deletedAt === null)
                ? <button type="button" onClick={() => onOpenSource(memo.memoQuote!.sourceMemoId)}>查看来源</button>
                : <span>来源已删除</span>}
            </div>
            <MarkdownView markdown={memo.memoQuote.snapshot} className="mn-memo-quote-content" />
          </aside>
        )}
        {plain && !editing && (
          <div className="mn-memo-interactions" aria-label="Memo 互动">
            <button type="button" aria-label={`评论${comments.length ? `，${comments.length} 条` : ""}`} title="评论" onClick={() => onOpenMemo(memo.id)}>
              <MessageCircle aria-hidden="true" />
              {comments.length > 0 && <span>{comments.length}</span>}
            </button>
            <button type="button" aria-label={memo.starred ? "取消收藏" : "收藏"} title={memo.starred ? "取消收藏" : "收藏"} aria-pressed={memo.starred} onClick={() => void saveItemMeta(userId, memo.id, { starred: !memo.starred })}>
              <Star aria-hidden="true" />
            </button>
            <button type="button" aria-label="引述" title="引述" onClick={() => onQuote(memo)}>
              <Repeat2 aria-hidden="true" />
            </button>
          </div>
        )}
        {plain && !editing && comments.length > 0 && (
          <>
            <button type="button" className="mn-memo-comments-toggle" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
              <ChevronDown /> {expanded ? "收起评论" : `展开 ${comments.length} 条评论`}
            </button>
            {expanded && <div className="mn-memo-inline-comments">
              {comments.map((comment) => <button type="button" key={comment.id} onClick={() => onOpenMemo(memo.id)}>
                <time>{new Date(comment.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</time>{comment.content.replace(/\s+/g, " ")}
              </button>)}
            </div>}
          </>
        )}
      </div>
    </article>
  );
}
