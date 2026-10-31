import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { Item } from "@menote/shared";
import { MarkdownView } from "../markdown";
import { setTaskCheckbox } from "../../lib/markdownTasks";
import { saveItemContent, softDeleteItem } from "../../services/contentService";

interface MemoTimelineProps {
  userId: string;
  memos: Item[];
  onDragItem: (event: React.DragEvent, id: string) => void;
}

/** Memo 时间线（FR-MEMO-1）：默认视图、原位编辑（源文本，保存/失焦渲染）、任务复选框可点。 */
export function MemoTimeline({ userId, memos, onDragItem }: MemoTimelineProps) {
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
  // design mgroup：按日分组，分组标题带延展线。
  const groups: Array<{ label: string; memos: Item[] }> = [];
  for (const memo of memos) {
    const label = new Date(memo.createdAt).toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.memos.push(memo);
    else groups.push({ label, memos: [memo] });
  }
  return (
    <div className="mn-timeline" aria-label="Memo 时间线">
      {groups.map((group) => (
        <section key={group.label}>
          <p className="mn-mgroup">{group.label}</p>
          {group.memos.map((memo) => <MemoCard key={memo.id} userId={userId} memo={memo} onDragItem={onDragItem} />)}
        </section>
      ))}
    </div>
  );
}

function MemoCard({ userId, memo, onDragItem }: { userId: string; memo: Item; onDragItem: (event: React.DragEvent, id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(memo.content.scope === "plain" ? memo.content.markdown : "");

  const commit = async () => {
    setEditing(false);
    if (memo.content.scope === "plain" && value !== memo.content.markdown) {
      await saveItemContent(userId, memo.id, value);
    }
  };

  const toggleTask = async (ordinal: number, checked: boolean) => {
    if (memo.content.scope !== "plain") return;
    const next = setTaskCheckbox(memo.content.markdown, ordinal, checked);
    if (next !== memo.content.markdown) await saveItemContent(userId, memo.id, next);
  };

  return (
    <article className="mn-memo-card" draggable={!editing}
      onDragStart={(event) => onDragItem(event, memo.id)}>
      <div className="mn-memo-meta">
        <time>{new Date(memo.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</time>
        <span className="mn-memo-actions">
          {!editing && (
            <button type="button" className="mn-minibtn" aria-label="编辑 Memo" onClick={() => { setValue(memo.content.scope === "plain" ? memo.content.markdown : ""); setEditing(true); }}>
              编辑
            </button>
          )}
          <button type="button" className="mn-minibtn" aria-label="移入回收站" onClick={() => void softDeleteItem(userId, memo.id)}>
            <Trash2 />
          </button>
        </span>
      </div>
      {editing ? (
        <textarea
          className="mn-memo-edit" autoFocus value={value} aria-label="编辑 Memo 源文本"
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setValue(memo.content.scope === "plain" ? memo.content.markdown : ""); setEditing(false); }
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") void commit();
          }}
        />
      ) : (
        <MarkdownView
          markdown={memo.content.scope === "plain" ? memo.content.markdown : ""}
          className="md-body mn-memo-body"
          onToggleTask={(ordinal, checked) => void toggleTask(ordinal, checked)}
        />
      )}
      {memo.tags.length > 0 && (
        <p className="mn-memo-tags">{memo.tags.map((tag) => `#${tag}`).join("  ")}</p>
      )}
    </article>
  );
}
