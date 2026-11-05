import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import type { LayoutMode } from "../../lib/layout";
import { useMemos } from "../../services/contentHooks";
import { MemoBar, type MemoView } from "./MemoBar";
import { MemoGallery } from "./MemoGallery";
import { MemoTimeline } from "./MemoTimeline";
import { MemoWorkbar } from "./MemoWorkbar";
import { TodoSidePanel } from "./TodoSidePanel";
import { filterMemos, memoImages, pickRandomMemo, type MemoRange } from "./memoView";

interface MemoWorkspaceProps {
  userId: string;
  layout: LayoutMode;
  todoOpen: boolean;
  onToggleTodo: () => void;
  onOpenDrawer: () => void;
  selectedMemoId?: string;
  onSelectMemo: (id: string) => void;
  /** 回到进入 Memo 之前的笔记位置。未接上时按钮不出现。 */
  onBackToNotes?: () => void;
}

/** Memo 视图：顶栏 + 工作栏浮层 + 时间线或图册。Todo 只在时间轴出现。 */
export function MemoWorkspace({ userId, layout, todoOpen, onToggleTodo, onOpenDrawer, selectedMemoId, onSelectMemo, onBackToNotes }: MemoWorkspaceProps) {
  const memos = useMemos(userId);
  const [range, setRange] = useState<MemoRange>("all");
  const [tag, setTag] = useState<string | null>(null);
  const [view, setView] = useState<MemoView>("timeline");
  const visible = filterMemos(memos, range, tag);
  const images = memoImages(visible);
  const singlePane = layout === "tablet" || layout === "mobile";

  useEffect(() => {
    if (!selectedMemoId) return;
    setView("timeline");
    window.setTimeout(() => {
      document.getElementById(`memo-${selectedMemoId}`)?.scrollIntoView({ block: "center" });
    }, 0);
  }, [selectedMemoId, memos]);

  const openMemo = (id: string) => {
    setView("timeline");
    onSelectMemo(id);
  };
  const openSource = (id: string) => {
    setRange("all");
    setTag(null);
    openMemo(id);
  };

  return (
    <main className={`mn-main mn-memo-main ${view === "gallery" ? "is-gallery" : ""}`} aria-label="Memo">
      <MemoBar
        count={view === "gallery" ? images.length : visible.length}
        unit={view === "gallery" ? "张" : "条"}
        filtered={range !== "all" || tag !== null}
        view={view}
        onView={setView}
        onBack={onBackToNotes}
      />
      <div className="mn-memo-stage">
        <MemoWorkbar
          memos={memos} range={range} tag={tag} onRange={setRange} onTag={setTag}
          onWander={() => { const picked = pickRandomMemo(visible); if (picked) openMemo(picked.id); }}
          onOpen={openMemo}
        />
        <section className="mn-memo-scroll" aria-label={view === "gallery" ? "Memo 图册" : "Memo 时间线"}>
          {singlePane && (
            <button type="button" className="mn-iconbtn mn-memo-drawer" aria-label="打开侧栏" onClick={onOpenDrawer}>
              <Menu />
            </button>
          )}
          {view === "gallery"
            ? <MemoGallery images={images} onOpen={openMemo} />
            : (
              <MemoTimeline
                userId={userId}
                memos={visible}
                allMemos={memos}
                onQuoted={(item) => { setRange("all"); setTag(null); openMemo(item.id); }}
                onOpenSource={openSource}
                onDragItem={(event, id) => event.dataTransfer.setData("text/menote-item", id)}
              />
            )}
        </section>
        {view === "timeline" && <TodoSidePanel userId={userId} memos={memos} open={todoOpen} onToggle={onToggleTodo} />}
      </div>
    </main>
  );
}
