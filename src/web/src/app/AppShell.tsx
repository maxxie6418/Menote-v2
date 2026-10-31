import { useEffect, useState } from "react";
import type { AuthUser } from "@menote/shared";
import { Sidebar } from "./Sidebar";
import { MainLayout } from "./MainLayout";
import { SystemStatusPage } from "./SystemStatusPage";
import { MemoWorkspace } from "../features/memo";
import { NoteDocument } from "../features/notes";
import type { BrowseSection } from "../services/contentHooks";
import { useSectionItems, useTopics } from "../services/contentHooks";
import { createNote, saveItemContent, sweepBlankDrafts } from "../services/contentService";

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

const SECTION_TITLES: Record<"recent" | "inbox" | "drafts" | "starred", string> = {
  recent: "全部笔记", inbox: "收件箱", drafts: "草稿箱", starred: "收藏",
};
const SECTION_EMPTY: Record<"recent" | "inbox" | "drafts" | "starred", [string, string]> = {
  recent: ["还没有笔记", "点「新建笔记」先写再分类；内容自动保存在本机。"],
  inbox: ["收件箱是空的", "外部采集与 Agent 新建的笔记会落到这里，整理后自动移出。"],
  drafts: ["草稿箱是空的", "新建笔记若未指定归属，会先收在这里。"],
  starred: ["还没有收藏", "在文档里点星标，收藏的笔记会出现在这里。"],
};

/* 主界面（M1.2 骨架 + E2 内容闭环）：三栏真数据、列表/网格、Memo 视图与 todo 侧板。 */
export function AppShell({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const layout = useLayoutMode();
  const [view, setView] = useState<MainView>("main");
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [section, setSection] = useState<BrowseSection>({ kind: "recent" });
  const [noteId, setNoteId] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>("list");
  const [todoOpen, setTodoOpen] = useState(false);
  const userId = user.id;

  // FR-VER-7 启动兜底：回收超期空白草稿种子（三道闸在服务内实现）。
  useEffect(() => { void sweepBlankDrafts(userId); }, [userId]);

  const topics = useTopics(userId);
  const items = useSectionItems(userId, section);

  if (view === "status") {
    return <SystemStatusPage onBack={() => setView("main")} />;
  }

  const account = { username: user.username, role: user.role };
  const shellProps = {
    "data-layout": layout,
    "data-sidebar": collapsed && layout === "compact" ? "collapsed" : "expanded",
  };
  const sidebar = (
    <Sidebar
      userId={userId}
      account={account}
      layout={layout}
      collapsed={collapsed && layout === "compact"}
      drawerOpen={drawerOpen}
      section={section}
      onSelectSection={(next) => { setSection(next); setNoteId(null); setMobilePane("list"); setDrawerOpen(false); }}
      onCreateNote={async () => {
        const created = await createNote(userId);
        setSection({ kind: "drafts" });
        setNoteId(created.id);
        setMobilePane("doc");
        setDrawerOpen(false);
      }}
      onLogout={onLogout}
      onToggleCollapse={() => setCollapsed((value) => !value)}
      onCloseDrawer={() => setDrawerOpen(false)}
      onOpenStatus={() => { setView("status"); setDrawerOpen(false); }}
    />
  );

  if (section.kind === "memos") {
    return (
      <div className="mn-shell" {...shellProps}>
        {drawerOpen && <div className="mn-overlay" onClick={() => setDrawerOpen(false)} />}
        {sidebar}
        <MemoWorkspace
          userId={userId}
          layout={layout}
          todoOpen={todoOpen}
          onToggleTodo={() => setTodoOpen((value) => !value)}
          onOpenDrawer={() => setDrawerOpen(true)}
          onOpenStatus={() => setView("status")}
        />
      </div>
    );
  }

  const title = section.kind === "topic"
    ? topics.find((row) => row.id === section.id)?.name ?? "主题"
    : section.kind === "tag" ? `#${section.tag}` : SECTION_TITLES[section.kind];
  const [emptyTitle, emptyDetail] = section.kind === "topic" || section.kind === "tag"
    ? ["这里还没有笔记", "换个分区，或新建一篇。"]
    : SECTION_EMPTY[section.kind];

  return (
    <div className="mn-shell" {...shellProps}>
      {drawerOpen && <div className="mn-overlay" onClick={() => setDrawerOpen(false)} />}
      {sidebar}
      <MainLayout
        layout={layout}
        viewMode={viewMode}
        onViewMode={setViewMode}
        title={title}
        items={items}
        selectedNoteId={noteId}
        onSelectNote={(id) => { setNoteId(id); setMobilePane("doc"); }}
        emptyTitle={emptyTitle}
        emptyDetail={emptyDetail}
        mobilePane={mobilePane}
        onBackToList={() => setMobilePane("list")}
        onOpenDrawer={() => setDrawerOpen(true)}
        document={noteId ? (
          <NoteDocument
            key={noteId}
            userId={userId}
            noteId={noteId}
            topics={topics}
            unfiled={section.kind === "inbox" || section.kind === "drafts"}
            onBack={() => setMobilePane("list")}
            showBack={layout === "tablet" || layout === "mobile"}
            crumb={title}
            onExtractDoc={async (content) => {
              const created = await createNote(userId, { title: "表格文档" });
              await saveItemContent(userId, created.id, content);
              setSection({ kind: "drafts" });
              setNoteId(created.id);
              setMobilePane("doc");
            }}
          />
        ) : (
          <article className="mn-doc" aria-label="文档区">
            <div className="mn-docbar">
              <span className="mn-docbar-left"><span className="mn-crumb">{title}</span></span>
            </div>
            <div className="mn-empty" role="status">
              <div>
                <p className="mn-empty-title">选择一篇，或新建</p>
                <p className="mn-empty-detail">文档区只在选中之后显示内容，不做引导页。</p>
              </div>
            </div>
          </article>
        )}
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
