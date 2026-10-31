import { LayoutGrid, List, Menu } from "lucide-react";
import type { LayoutMode, MobilePane, ViewMode } from "./AppShell";
import { NoteDocument } from "../notes/NoteDocument";
import { NoteGrid } from "../notes/NoteGrid";
import { NoteList } from "../notes/NoteList";
import { DEMO_NOTICE, demoDocument, demoEmptyState, demoListTitle, demoNotes, demoTopics, type DemoNote } from "../lib/demoData";

interface MainLayoutProps {
  layout: LayoutMode;
  viewMode: ViewMode;
  onViewMode: (mode: ViewMode) => void;
  selectedTopicId: string;
  selectedNoteId: string | null;
  onSelectNote: (noteId: string) => void;
  mobilePane: MobilePane;
  onBackToList: () => void;
  onOpenDrawer: () => void;
  notes: DemoNote[];
}

const demoTopicName = (topicId: string) =>
  topicId === "inbox" ? "收件箱" : topicId === "drafts" ? demoEmptyState.draftsTitle : demoTopics.find((topic) => topic.id === topicId)?.name ?? demoListTitle.topic;

export function MainLayout({ layout, viewMode, onViewMode, selectedTopicId, selectedNoteId, onSelectNote, mobilePane, onBackToList, onOpenDrawer, notes }: MainLayoutProps) {
  const isSpecialView = selectedTopicId === "inbox" || selectedTopicId === "drafts";
  const visibleNotes = isSpecialView ? [] : notes;
  const headTitle = demoTopicName(selectedTopicId);
  const headCount = isSpecialView ? demoEmptyState.draftsCount : `${demoListTitle.count} 篇`;
  const selectedNote = visibleNotes.find((note) => note.id === selectedNoteId) ?? null;
  const singlePane = layout === "tablet" || layout === "mobile";
  const showList = !singlePane || mobilePane === "list";
  const showDoc = !singlePane || mobilePane === "doc";

  return (
    <main className="mn-main" aria-label="主区">
      {showList && (
        <section className="mn-listcol" aria-label="笔记清单">
          <div className="mn-listhead">
            <span className="mn-listhead-left">
              {singlePane && (
                <button type="button" className="mn-iconbtn" aria-label="打开侧栏" onClick={onOpenDrawer}>
                  <Menu />
                </button>
              )}
              <span className="mn-listhead-title">
                {headTitle} <span className="mn-listhead-count">{headCount}</span>
              </span>
              <span className="mn-demo-chip">{DEMO_NOTICE}</span>
            </span>
            {!isSpecialView && (
              <span className="mn-vt" role="group" aria-label="视图切换">
                <button type="button" className={viewMode === "list" ? "on" : ""} aria-label="列表视图" aria-pressed={viewMode === "list"} onClick={() => onViewMode("list")}>
                  <List />
                </button>
                <button type="button" className={viewMode === "grid" ? "on" : ""} aria-label="网格视图" aria-pressed={viewMode === "grid"} onClick={() => onViewMode("grid")}>
                  <LayoutGrid />
                </button>
              </span>
            )}
          </div>
          {viewMode === "list"
            ? <NoteList notes={visibleNotes} selectedNoteId={selectedNoteId} onSelectNote={onSelectNote} />
            : <NoteGrid notes={visibleNotes} selectedNoteId={selectedNoteId} onSelectNote={onSelectNote} />}
        </section>
      )}
      {showDoc && (
        <NoteDocument
          note={selectedNote}
          onBack={onBackToList}
          showBack={singlePane && Boolean(selectedNote)}
        />
      )}
    </main>
  );
}
