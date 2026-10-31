import { LayoutGrid, List, Menu } from "lucide-react";
import type { LayoutMode, MobilePane, ViewMode } from "./AppShell";
import { NoteDocument, NoteGrid, NoteList } from "../features/notes";

interface MainLayoutProps {
  layout: LayoutMode;
  viewMode: ViewMode;
  onViewMode: (mode: ViewMode) => void;
  selectedSection: "all" | "inbox" | "drafts";
  mobilePane: MobilePane;
  onBackToList: () => void;
  onOpenDrawer: () => void;
}

const sectionTitle = { all: "全部笔记", inbox: "收件箱", drafts: "草稿箱" } as const;

/* 主区骨架（M1.2）：清单/网格双布局壳与空态；内容列表在 M2 接入业务后填充。 */
export function MainLayout({ layout, viewMode, onViewMode, selectedSection, mobilePane, onBackToList, onOpenDrawer }: MainLayoutProps) {
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
              <span className="mn-listhead-title">{sectionTitle[selectedSection]}</span>
            </span>
            <span className="mn-vt" role="group" aria-label="视图切换">
              <button type="button" className={viewMode === "list" ? "on" : ""} aria-label="列表视图" aria-pressed={viewMode === "list"} onClick={() => onViewMode("list")}>
                <List />
              </button>
              <button type="button" className={viewMode === "grid" ? "on" : ""} aria-label="网格视图" aria-pressed={viewMode === "grid"} onClick={() => onViewMode("grid")}>
                <LayoutGrid />
              </button>
            </span>
          </div>
          {viewMode === "list" ? <NoteList /> : <NoteGrid />}
        </section>
      )}
      {showDoc && <NoteDocument onBack={onBackToList} showBack={singlePane} crumb={sectionTitle[selectedSection]} />}
    </main>
  );
}
