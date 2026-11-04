import { LayoutGrid, List, Menu, Plus, Search } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Item } from "@menote/shared";
import type { LayoutMode, MobilePane, ViewMode } from "../lib/layout";
import { NoteGrid, NoteList } from "../features/notes";
import { filterItems } from "../services/searchService";

interface MainLayoutProps {
  layout: LayoutMode;
  viewMode: ViewMode;
  onViewMode: (mode: ViewMode) => void;
  title: string;
  items: Item[] | undefined;
  selectedNoteId: string | null;
  onSelectNote: (id: string) => void;
  onMoveNote?: (item: Item) => void | Promise<unknown>;
  onToggleStar?: (item: Item) => void | Promise<unknown>;
  onTrashNote?: (item: Item) => void | Promise<unknown>;
  onAiSummary?: (item: Item) => void;
  onCreateNote?: () => void;
  emptyTitle: string;
  emptyDetail: string;
  document: ReactNode;
  headerExtra?: ReactNode;
  mobilePane: MobilePane;
  onBackToList: () => void;
  onOpenDrawer: () => void;
}

/* 主区：清单/网格双布局壳（FR-IA-7）+ 文档区；数据由 AppShell 注入。 */
export function MainLayout({ layout, viewMode, onViewMode, title, items, selectedNoteId, onSelectNote, onMoveNote, onToggleStar, onTrashNote, onAiSummary, onCreateNote, emptyTitle, emptyDetail, document, headerExtra, mobilePane, onBackToList, onOpenDrawer }: MainLayoutProps) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const filtering = query.trim().length > 0;
  const shown = items ? filterItems(items, query) : items;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !(event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable=true]"))) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
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
              <span className="mn-listhead-title">{title}</span>
            </span>
            {headerExtra}
            {onCreateNote && <button type="button" className="mn-iconbtn" aria-label="在当前主题或分类中新建笔记" title="新建笔记" onClick={onCreateNote}><Plus /></button>}
            <span className="mn-vt" role="group" aria-label="视图切换">
              <button type="button" className={viewMode === "list" ? "on" : ""} aria-label="列表视图" aria-pressed={viewMode === "list"} onClick={() => onViewMode("list")}>
                <List />
              </button>
              <button type="button" className={viewMode === "grid" ? "on" : ""} aria-label="网格视图" aria-pressed={viewMode === "grid"} onClick={() => onViewMode("grid")}>
                <LayoutGrid />
              </button>
            </span>
          </div>
          <label className="mn-listsearch">
            <Search aria-hidden="true" />
            <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索当前清单" aria-label="搜索当前清单" />
          </label>
          {viewMode === "list"
            ? <NoteList items={shown} selectedId={selectedNoteId} onSelect={onSelectNote} emptyTitle={filtering ? "没有匹配的内容" : emptyTitle} emptyDetail={filtering ? "换个词，或清空搜索。" : emptyDetail} onMove={onMoveNote} onToggleStar={onToggleStar} onTrash={onTrashNote} onAiSummary={onAiSummary} />
            : <NoteGrid items={shown} selectedId={selectedNoteId} onSelect={onSelectNote} emptyTitle={filtering ? "没有匹配的内容" : emptyTitle} emptyDetail={filtering ? "换个词，或清空搜索。" : emptyDetail} />}
        </section>
      )}
      {showDoc && document}
    </main>
  );
}
