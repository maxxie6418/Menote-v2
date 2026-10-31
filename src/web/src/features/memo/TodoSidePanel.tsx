import { useState } from "react";
import type { Item } from "@menote/shared";
import { saveItemMeta } from "../../services/contentService";

const GROUPS = [
  { status: "todo", label: "待办" },
  { status: "doing", label: "进行中" },
  { status: "done", label: "已完成" },
] as const;

type MemoStatus = (typeof GROUPS)[number]["status"];

interface TodoSidePanelProps {
  userId: string;
  memos: Item[];
  open: boolean;
  onToggle: () => void;
}

/** todo 侧板（FR-MEMO-5）：仅 Memo 视图旁可折叠；单一互斥状态；拖入分组即改状态；
 *  勾选即完成、取消回待办；无推进按钮与状态下拉框；已完成组默认折叠。 */
export function TodoSidePanel({ userId, memos, open, onToggle }: TodoSidePanelProps) {
  const withStatus = memos.filter((memo) => memo.status !== null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set(["done"]));

  if (!open) {
    return (
      <button type="button" className="mn-todopanel-toggle" aria-label="展开 todo 侧板" onClick={onToggle}>
        todo
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
    <aside className="mn-todopanel" aria-label="todo 侧板">
      <div className="mn-todopanel-head">
        <span className="mn-seclabel-text">todo</span>
        <button type="button" className="mn-minibtn" aria-label="折叠 todo 侧板" onClick={onToggle}>收起</button>
      </div>
      {withStatus.length === 0 && <p className="mn-tree-empty">把时间线里的 Memo 拖进来安排状态。</p>}
      {GROUPS.map(({ status, label }) => {
        const items = withStatus.filter((memo) => memo.status === status);
        const collapsed = collapsedGroups.has(status);
        return (
          <section
            key={status}
            className="mn-todogroup"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => void dropOn(status)(event)}
          >
            <button type="button" className="mn-seclabel" aria-expanded={!collapsed} onClick={() => toggleGroup(status)}>
              <span className="mn-seclabel-text">{label}（{items.length}）</span>
            </button>
            {!collapsed && (
              <ul className="mn-todolist">
                {items.map((memo) => (
                  <li key={memo.id} className={`mn-todoitem ${status}`} draggable
                    onDragStart={(event) => event.dataTransfer.setData("text/menote-item", memo.id)}>
                    <span className={`mn-todo-dot ${status}`} aria-hidden="true" />
                    <input
                      type="checkbox" aria-label={status === "done" ? "取消完成" : "标记完成"}
                      checked={status === "done"}
                      onChange={() => void saveItemMeta(userId, memo.id, { status: status === "done" ? "todo" : "done" })}
                    />
                    <button type="button" className="mn-todoitem-text" onClick={() => void saveItemMeta(userId, memo.id, { status: null })}>
                      {memo.content.scope === "plain" ? memo.content.markdown.replace(/\s+/g, " ").slice(0, 40) || "（空白）" : "已加密"}
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
