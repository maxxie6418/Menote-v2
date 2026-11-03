import { useState } from "react";
import type { Item, TopicNode } from "@menote/shared";

interface OrganizeDialogProps {
  item: Item;
  topics: TopicNode[];
  onDone: () => void;
  onMove: (topicId: string, groupId: string | null) => Promise<void>;
  onDelete?: () => Promise<void>;
  allowDelete?: boolean;
}

/** 收件箱/草稿箱整理（FR-IA-9）：指定主题/分组后自动移出；支持直接删除；不做 Note→Memo 转换。 */
export function OrganizeDialog({ item, topics, onDone, onMove, onDelete, allowDelete = true }: OrganizeDialogProps) {
  const [topicId, setTopicId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = topics.filter((row) => row.deletedAt === null);
  const chosen = active.find((row) => row.id === topicId && row.depth === 0);
  const groups = active.filter((row) => row.depth === 1 && row.parentId === topicId);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onMove(topicId, groupId || null);
      onDone();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy || !onDelete) return;
    setBusy(true);
    try {
      await onDelete();
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mn-overlay" role="presentation">
      <div className="mn-dialog" role="dialog" aria-modal="true" aria-label="整理笔记">
        <div className="mn-dialog-head"><p className="mn-dialog-title">整理「{item.title}」</p></div>
        <div className="mn-dialog-body">
          <label className="mn-auth-field">
            <span>主题</span>
            <select value={topicId} onChange={(event) => { setTopicId(event.target.value); setGroupId(""); }}>
              <option value="">（选择主题）</option>
              {active.filter((row) => row.depth === 0 && !row.isEncSpace).map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
          </label>
          {chosen && (
            <label className="mn-auth-field">
              <span>分组（可选）</span>
              <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
                <option value="">（不选分组）</option>
                {groups.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </label>
          )}
          {error && <p className="mn-auth-error" role="alert">{error}</p>}
        </div>
        <div className="mn-dialog-actions">
          <button type="button" className="mn-auth-submit" disabled={busy || !topicId} aria-disabled={busy || !topicId} onClick={submit}>
            移入并整理
          </button>
          {allowDelete && onDelete && <button type="button" className="mn-auth-link" disabled={busy} onClick={remove}>移入回收站</button>}
          <button type="button" className="mn-auth-link" onClick={onDone}>取消</button>
        </div>
      </div>
    </div>
  );
}
