import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Item } from "@menote/shared";
import { saveItemMeta } from "../../services/contentService";
import { isPlainMemo, memoText } from "./memoView";

const GROUPS = [
  { status: "doing", label: "进行中" },
  { status: "todo", label: "待办" },
  { status: "done", label: "已完成" },
] as const;

type MemoStatus = (typeof GROUPS)[number]["status"];

interface TodoSidePanelProps {
  userId: string;
  memos: Item[];
  open: boolean;
  onToggle: () => void;
}

/** todo 侧板（FR-MEMO-5）：仅 Memo 视图旁的浮层，不占栅格列。
 *  单一互斥状态；拖入分组即改状态；勾选即完成、取消回待办；已完成组默认折叠。 */
export function TodoSidePanel({ userId, memos, open, onToggle }: TodoSidePanelProps) {
  const withStatus = memos.filter((memo) => memo.status !== null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set(["done"]));

  if (!open) {
    return (
      <button type="button" className="mn-memo-todo-toggle" aria-label="展开 todo" onClick={onToggle}>
        Todo
      </button>
    );
  }

  const toggleGroup = (status: string) => {
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(status)) next.delete(status); else next.add(status);
      return next;
    });
  };

  const dropOn = (status: MemoStatus) => async (event: React.DragEvent) => {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/menote-item");
    if (!id) return;
    await saveItemMeta(userId, id, { status });
  };

  return (
    <aside className="mn-memo-todo" aria-label="todo">
      <div className="mn-memo-todo-head">
        <span>Todo</span>
        <span className="mn-memo-todo-count">{withStatus.length}</span>
        <button type="button" aria-label="折叠 todo" onClick={onToggle}><ChevronRight /></button>
      </div>
      {withStatus.length === 0 && <p className="mn-memo-todo-empty">把时间线里的 Memo 拖进来安排状态。</p>}
      {GROUPS.map(({ status, label }) => {
        const items = withStatus.filter((memo) => memo.status === status);
        const collapsed = collapsedGroups.has(status);
        return (
          <section key={status} onDragOver={(event) => event.preventDefault()} onDrop={(event) => void dropOn(status)(event)}>
            <button type="button" className="mn-memo-todo-group" aria-expanded={!collapsed} onClick={() => toggleGroup(status)}>
              {label}<span>{items.length}</span>
            </button>
            {!collapsed && (
              <ul>
                {items.map((memo) => (
                  <li key={memo.id} className={status} draggable onDragStart={(event) => event.dataTransfer.setData("text/menote-item", memo.id)}>
                    <i />
                    <input
                      type="checkbox" aria-label={status === "done" ? "取消完成" : "标记完成"}
                      checked={status === "done"}
                      onChange={() => void saveItemMeta(userId, memo.id, { status: status === "done" ? "todo" : "done" })}
                    />
                    <button type="button" onClick={() => void saveItemMeta(userId, memo.id, { status: null })}>
                      {isPlainMemo(memo) ? memoText(memo).replace(/\s+/g, " ").slice(0, 40) || "（空白）" : "已加密"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </aside>
  );
}
