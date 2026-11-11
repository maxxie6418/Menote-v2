import { useEffect, useState } from "react";
import { Menu } from "../../icons";
import type { LayoutMode } from "../../lib/layout";
import { useMemos, useTopics } from "../../services/contentHooks";
import { alwaysHiddenPrivateTopicIds } from "../../services/privateSpaceService";
import { MemoBar, MemoViewToggle, type MemoView } from "./MemoBar";
import { MemoGallery } from "./MemoGallery";
import { MemoTimeline } from "./MemoTimeline";
import { MemoWorkbar } from "./MemoWorkbar";
import { TodoSidePanel } from "./TodoSidePanel";
import { filterMemos, memoImages, pickRandomMemo, type MemoRange } from "./memoView";
import { QuickComposer } from "./QuickComposer";

interface MemoWorkspaceProps {
  userId: string;
  username: string;
  layout: LayoutMode;
  todoOpen: boolean;
  onToggleTodo: () => void;
  selectedMemoId?: string;
  onSelectMemo: (id: string) => void;
  onOpenNote: (id: string) => void;
  /** 回到进入 Memo 之前的笔记位置。未接上时按钮不出现。 */
  onBackToNotes?: () => void;
}

/** Memo 视图：顶栏 + 工作栏浮层 + 时间线或图册。Todo 只在时间轴出现。 */
export function MemoWorkspace({ userId, username, layout, todoOpen, onToggleTodo, selectedMemoId, onSelectMemo, onOpenNote, onBackToNotes }: MemoWorkspaceProps) {
  const allMemos = useMemos(userId);
  const topics = useTopics(userId);
  const memos = allMemos.filter((memo) => memo.topicId === null || !alwaysHiddenPrivateTopicIds(topics).has(memo.topicId));
  const [range, setRange] = useState<MemoRange>("all");
  const [tag, setTag] = useState<string | null>(null);
  const [view, setView] = useState<MemoView>("timeline");
  const [workbarOpen, setWorkbarOpen] = useState(false);
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
        onBack={onBackToNotes}
      />
      <div className={`mn-memo-stage${workbarOpen ? " is-work-open" : ""}${layout === "mobile" && todoOpen ? " is-todo-open" : ""}`}>
        <MemoWorkbar
          memos={memos} range={range} tag={tag} onRange={setRange} onTag={setTag}
          onWander={() => { const picked = pickRandomMemo(visible); if (picked) openMemo(picked.id); }}
          onOpen={openMemo}
          onClose={() => setWorkbarOpen(false)}
          view={view}
          onView={setView}
        />
        <section className="mn-memo-scroll" aria-label={view === "gallery" ? "Memo 图册" : "Memo 时间线"}>
          {singlePane && (
            <div className="mn-memo-mobile-controls">
              <button type="button" className="mn-iconbtn mn-memo-drawer" aria-label="打开 Memo 侧记栏" aria-expanded={workbarOpen} onClick={() => { if (todoOpen) onToggleTodo(); setWorkbarOpen(true); }}><Menu /></button>
              <MemoViewToggle view={view} onView={setView} />
              {view === "timeline" && <button type="button" className="mn-memo-mobile-todo-toggle" aria-label={todoOpen ? "关闭 Todo 面板" : "打开 Todo 面板"} aria-expanded={todoOpen} onClick={() => { setWorkbarOpen(false); onToggleTodo(); }}>Todo</button>}
            </div>
          )}
          {view === "gallery"
            ? <MemoGallery images={images} onOpen={openMemo} />
            : (
              <>
              <QuickComposer userId={userId} expandedByDefault keepOpenAfterSubmit />
              <MemoTimeline
                userId={userId}
                username={username}
                memos={visible}
                allMemos={memos}
                onQuoted={(item) => { setRange("all"); setTag(null); openMemo(item.id); }}
                onOpenSource={openSource}
                onOpenNote={onOpenNote}
                onDragItem={(event, id) => event.dataTransfer.setData("text/menote-item", id)}
              />
              </>
            )}
        </section>
        {singlePane && workbarOpen && <button type="button" className="mn-memo-work-backdrop" aria-label="关闭 Memo 侧记栏" onClick={() => setWorkbarOpen(false)} />}
        {layout === "mobile" && todoOpen && view === "timeline" && <button type="button" className="mn-memo-todo-backdrop" aria-label="关闭 Todo 面板" onClick={onToggleTodo} />}
        {view === "timeline" && <TodoSidePanel userId={userId} memos={memos} open={todoOpen} onToggle={onToggleTodo} />}
      </div>
    </main>
  );
}
