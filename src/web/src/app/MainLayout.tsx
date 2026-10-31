import { LayoutGrid, List, Menu } from "lucide-react";
import type { ReactNode } from "react";
import type { Item } from "@menote/shared";
import type { LayoutMode, MobilePane, ViewMode } from "./AppShell";
import { NoteGrid, NoteList } from "../features/notes";

interface MainLayoutProps {
  layout: LayoutMode;
  viewMode: ViewMode;
  onViewMode: (mode: ViewMode) => void;
  title: string;
  items: Item[] | undefined;
  selectedNoteId: string | null;
  onSelectNote: (id: string) => void;
  emptyTitle: string;
  emptyDetail: string;
  document: ReactNode;
  headerExtra?: ReactNode;
  mobilePane: MobilePane;
  onBackToList: () => void;
  onOpenDrawer: () => void;
}

/* 主区：清单/网格双布局壳（FR-IA-7）+ 文档区；数据由 AppShell 注入。 */
export function MainLayout({ layout, viewMode, onViewMode, title, items, selectedNoteId, onSelectNote, emptyTitle, emptyDetail, document, headerExtra, mobilePane, onBackToList, onOpenDrawer }: MainLayoutProps) {
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
            <span className="mn-vt" role="group" aria-label="视图切换">
              <button type="button" className={viewMode === "list" ? "on" : ""} aria-label="列表视图" aria-pressed={viewMode === "list"} onClick={() => onViewMode("list")}>
                <List />
              </button>
              <button type="button" className={viewMode === "grid" ? "on" : ""} aria-label="网格视图" aria-pressed={viewMode === "grid"} onClick={() => onViewMode("grid")}>
                <LayoutGrid />
              </button>
            </span>
          </div>
          {viewMode === "list"
            ? <NoteList items={items} selectedId={selectedNoteId} onSelect={onSelectNote} emptyTitle={emptyTitle} emptyDetail={emptyDetail} />
            : <NoteGrid items={items} selectedId={selectedNoteId} onSelect={onSelectNote} emptyTitle={emptyTitle} emptyDetail={emptyDetail} />}
        </section>
      )}
      {showDoc && document}
    </main>
  );
}
