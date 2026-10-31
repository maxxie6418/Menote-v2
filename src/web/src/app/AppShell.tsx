import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { MainLayout } from "./MainLayout";
import { SystemStatusPage } from "./SystemStatusPage";

/* 断点常量（DESIGN §8.1）。CSS 不写媒体查询：由这里检测后输出 data-layout，
   断点数值集中在常量，便于测试与调整。 */
export const BREAKPOINTS = { full: 1280, compact: 1024, tablet: 768 } as const;
export type LayoutMode = "full" | "compact" | "tablet" | "mobile";
export type MainView = "main" | "status";
export type ViewMode = "list" | "grid";
export type MobilePane = "list" | "doc";

function detectLayoutMode(): LayoutMode {
  if (typeof window === "undefined") return "full";
  const width = window.innerWidth;
  if (width >= BREAKPOINTS.full) return "full";
  if (width >= BREAKPOINTS.compact) return "compact";
  if (width >= BREAKPOINTS.tablet) return "tablet";
  return "mobile";
}

function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(detectLayoutMode);
  useEffect(() => {
    const update = () => setMode(detectLayoutMode());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return mode;
}

/* 主界面骨架（M1.2）：仅结构与空态；清单、文档等内容视图在 M2 接入业务后填充。 */
export function AppShell() {
  const layout = useLayoutMode();
  const [view, setView] = useState<MainView>("main");
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedSection, setSelectedSection] = useState<"all" | "inbox" | "drafts">("all");
  const [mobilePane, setMobilePane] = useState<MobilePane>("list");

  if (view === "status") {
    return <SystemStatusPage onBack={() => setView("main")} />;
  }

  return (
    <div className="mn-shell" data-layout={layout} data-sidebar={collapsed && layout === "compact" ? "collapsed" : "expanded"}>
      {drawerOpen && <div className="mn-overlay" onClick={() => setDrawerOpen(false)} />}
      <Sidebar
        layout={layout}
        collapsed={collapsed && layout === "compact"}
        drawerOpen={drawerOpen}
        selectedSection={selectedSection}
        onSelectSection={(section) => { setSelectedSection(section); setMobilePane("list"); setDrawerOpen(false); }}
        onToggleCollapse={() => setCollapsed((value) => !value)}
        onCloseDrawer={() => setDrawerOpen(false)}
        onOpenStatus={() => { setView("status"); setDrawerOpen(false); }}
      />
      <MainLayout
        layout={layout}
        viewMode={viewMode}
        onViewMode={setViewMode}
        selectedSection={selectedSection}
        mobilePane={mobilePane}
        onBackToList={() => setMobilePane("list")}
        onOpenDrawer={() => setDrawerOpen(true)}
      />
      {layout === "mobile" && (
        <nav className="mn-bottomnav" aria-label="主导航">
          <button type="button" className={mobilePane === "list" ? "on" : ""} onClick={() => setMobilePane("list")}>
            清单
          </button>
          <button type="button" className={mobilePane === "doc" ? "on" : ""} onClick={() => setMobilePane("doc")}>
            文档
          </button>
          <button type="button" onClick={() => setView("status")}>
            状态
          </button>
        </nav>
      )}
    </div>
  );
}
