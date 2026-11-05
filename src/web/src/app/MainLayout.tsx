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
  onBatchMove?: (items: Item[]) => void;
  onBatchTrash?: (items: Item[]) => void | Promise<boolean>;
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
export function MainLayout({ layout, viewMode, onViewMode, title, items, selectedNoteId, onSelectNote, onMoveNote, onToggleStar, onTrashNote, onAiSummary, onBatchMove, onBatchTrash, onCreateNote, emptyTitle, emptyDetail, document, headerExtra, mobilePane, onBackToList, onOpenDrawer }: MainLayoutProps) {
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const anchorId = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const filtering = query.trim().length > 0;
  const shown = items ? filterItems(items, query) : items;
  const pickable = (shown ?? []).filter((item) => item.type !== "memo");
  useEffect(() => {
    setPicking(false);
    setPicked(new Set());
  }, [title]);
  const togglePicked = (id: string, extend: boolean) => {
    setPicked((current) => {
      const next = new Set(current);
      if (extend && anchorId.current) {
        const ids = pickable.map((item) => item.id);
        const from = ids.indexOf(anchorId.current);
        const to = ids.indexOf(id);
        if (from >= 0 && to >= 0) {
          const [start, end] = from < to ? [from, to] : [to, from];
          for (const pickedId of ids.slice(start, end + 1)) next.add(pickedId);
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchorId.current = id;
  };
  const pickedItems = pickable.filter((item) => picked.has(item.id));
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
            {onBatchMove && onBatchTrash && pickable.length > 0 && (
              <button type="button" className="mn-textbtn" aria-pressed={picking} onClick={() => { setPicking((value) => !value); setPicked(new Set()); }}>选择</button>
            )}
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
          {picking && (
            <div className="mn-listpick" role="toolbar" aria-label="批量操作">
              <span>已选 {pickedItems.length}</span>
              <button type="button" className="mn-textbtn" onClick={() => setPicked(new Set(pickable.map((item) => item.id)))}>全选</button>
              <button type="button" className="mn-textbtn" disabled={pickedItems.length === 0} onClick={() => onBatchMove?.(pickedItems)}>移动</button>
              <button type="button" className="mn-textbtn" disabled={pickedItems.length === 0} onClick={() => { void Promise.resolve(onBatchTrash?.(pickedItems)).then((done) => { if (done) { setPicked(new Set()); setPicking(false); } }); }}>移入回收站</button>
              <button type="button" className="mn-textbtn" onClick={() => { setPicking(false); setPicked(new Set()); }}>取消</button>
            </div>
          )}
          {viewMode === "list"
            ? <NoteList items={shown} selectedId={selectedNoteId} onSelect={onSelectNote} emptyTitle={filtering ? "没有匹配的内容" : emptyTitle} emptyDetail={filtering ? "换个词，或清空搜索。" : emptyDetail} onMove={onMoveNote} onToggleStar={onToggleStar} onTrash={onTrashNote} onAiSummary={onAiSummary} picking={picking} pickedIds={picked} onTogglePicked={togglePicked} />
            : <NoteGrid items={shown} selectedId={selectedNoteId} onSelect={onSelectNote} emptyTitle={filtering ? "没有匹配的内容" : emptyTitle} emptyDetail={filtering ? "换个词，或清空搜索。" : emptyDetail} picking={picking} pickedIds={picked} onTogglePicked={togglePicked} />}
        </section>
      )}
      {showDoc && document}
    </main>
  );
}
