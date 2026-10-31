import { Menu } from "lucide-react";
import type { LayoutMode } from "../../lib/layout";
import { MemoTimeline, TodoSidePanel } from "./index";
import { useMemos } from "../../services/contentHooks";

interface MemoWorkspaceProps {
  userId: string;
  layout: LayoutMode;
  todoOpen: boolean;
  onToggleTodo: () => void;
  onOpenDrawer: () => void;
  onOpenStatus: () => void;
}

/** Memo 视图：时间线 + todo 侧板（FR-MEMO-5：侧板仅在 Memo 视图旁，不延伸到 Note 阅读区）。 */
export function MemoWorkspace({ userId, layout, todoOpen, onToggleTodo, onOpenDrawer, onOpenStatus }: MemoWorkspaceProps) {
  const memos = useMemos(userId);
  const singlePane = layout === "tablet" || layout === "mobile";
  return (
    <main className="mn-main mn-memo-main" aria-label="Memo">
      <section className="mn-listcol" aria-label="Memo 时间线">
        <div className="mn-listhead">
          <span className="mn-listhead-left">
            {singlePane && (
              <button type="button" className="mn-iconbtn" aria-label="打开侧栏" onClick={onOpenDrawer}>
                <Menu />
              </button>
            )}
            <span className="mn-listhead-title">Memo 时间线</span>
          </span>
          {singlePane && (
            <button type="button" className="mn-minibtn" onClick={onOpenStatus}>状态</button>
          )}
        </div>
        <MemoTimeline
          userId={userId} memos={memos}
          onDragItem={(event, id) => event.dataTransfer.setData("text/menote-item", id)}
        />
      </section>
      <TodoSidePanel userId={userId} memos={memos} open={todoOpen} onToggle={onToggleTodo} />
    </main>
  );
}
