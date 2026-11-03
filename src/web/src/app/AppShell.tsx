import { useCallback, useEffect, useRef, useState } from "react";
import type { AuthUser, Item } from "@menote/shared";
import { Sidebar } from "./Sidebar";
import { MainLayout } from "./MainLayout";
import { SystemStatusPage } from "./SystemStatusPage";
import { MemoWorkspace } from "../features/memo";
import { NoteDocument, OrganizeDialog, TrashItemPanel } from "../features/notes";
import { purgeItemsPermanently } from "../services/versionService";
import type { BrowseSection } from "../services/contentHooks";
import { subscribeLocalChanges } from "../lib/broadcast";
import { useLockVersion, useSectionItems, useTopics } from "../services/contentHooks";
import { saveItemMeta, softDeleteItem, sweepBlankDrafts } from "../services/contentService";
import { createNoteForPlace } from "../services/privateSpaceService";
import { prefetchSettings } from "../services/settingsPrefetch";
import { requestSync } from "../services/syncEngine";
import { isTopicUnlocked, lockIfIdle } from "../services/keyringService";
import { PrivateSpaceDialog } from "../features/encryption";
import { SettingsDialog, type SettingsSection } from "../features/settings";
import { HomePage } from "./HomePage";
import { MobileApp } from "./MobileApp";
import { appRoutePath, parseAppRoute, type AppRoute, type RouteSection } from "./appRoutes";

/* 断点常量（DESIGN §8.1）在 lib/layout；CSS 不写媒体查询：由这里检测后输出 data-layout。 */
import { BREAKPOINTS, type LayoutMode, type MainView, type MobilePane, type ViewMode } from "../lib/layout";
export type { LayoutMode, MainView, MobilePane, ViewMode };
export { BREAKPOINTS };

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

/* 指针类型（DESIGN §4.4）：触屏设备不接管滚动条，保留系统覆盖式滚动条。
   与断点同理由 JS 检测后写 data-pointer，CSS 不写媒体查询。 */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarse(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return coarse;
}

const SECTION_TITLES: Record<"recent" | "inbox" | "drafts" | "starred" | "trash", string> = {
  recent: "全部笔记", inbox: "收件箱", drafts: "草稿箱", starred: "收藏", trash: "回收站",
};
const SECTION_EMPTY: Record<"recent" | "inbox" | "drafts" | "starred" | "trash", [string, string]> = {
  recent: ["还没有笔记", "点「新建笔记」先写再分类；内容自动保存在本机。"],
  inbox: ["收件箱是空的", "外部采集与 Agent 新建的笔记会落到这里，整理后自动移出。"],
  drafts: ["草稿箱是空的", "新建笔记若未指定归属，会先收在这里。"],
  starred: ["还没有收藏", "在文档里点星标，收藏的笔记会出现在这里。"],
  trash: ["回收站是空的", "移入回收站的内容会出现在这里，可恢复或永久删除。"],
};

function routeSection(route: AppRoute): BrowseSection {
  if (route.kind === "notes") return route.section;
  if (route.kind === "memos") return { kind: "memos" };
  return { kind: "home" };
}

function sectionRoute(section: BrowseSection, itemId?: string): AppRoute {
  if (section.kind === "home") return { kind: "home" };
  if (section.kind === "memos") return { kind: "memos", ...(itemId ? { itemId } : {}) };
  return { kind: "notes", section: section as RouteSection, ...(itemId ? { itemId } : {}) };
}

/* 主界面（M1.2 骨架 + E2 内容闭环）：三栏真数据、列表/网格、Memo 视图与 todo 侧板。 */
export function AppShell({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const layout = useLayoutMode();
  const coarsePointer = useCoarsePointer();
  const [route, setRoute] = useState<AppRoute>(() => parseAppRoute(window.location.pathname));
  const navigate = useCallback((next: AppRoute, replace = false) => {
    const pathname = appRoutePath(next);
    if (window.location.pathname !== pathname) {
      const state = replace
        ? { ...window.history.state, menoteRoute: true }
        : { menoteRoute: true, menoteParentPath: window.location.pathname };
      if (replace) window.history.replaceState(state, "", pathname);
      else window.history.pushState(state, "", pathname);
    }
    setRoute(next);
  }, []);
  const goBack = useCallback((fallback: AppRoute) => {
    if (window.history.state?.menoteParentPath) window.history.back();
    else navigate(fallback, true);
  }, [navigate]);
  const [view, setView] = useState<MainView>(() => route.kind === "status" ? "status" : "main");
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [section, setSection] = useState<BrowseSection>(() => routeSection(route));
  const [noteId, setNoteId] = useState<string | null>(() => route.kind === "notes" ? route.itemId ?? null : null);
  const [organizingItem, setOrganizingItem] = useState<Item | null>(null);
  const [noteReturn, setNoteReturn] = useState<{ section: BrowseSection; noteId: string | null }>({ section: { kind: "recent" }, noteId: null });
  const noteReturnRef = useRef(noteReturn);
  noteReturnRef.current = noteReturn;
  const [mobilePane, setMobilePane] = useState<MobilePane>("list");
  const [todoOpen, setTodoOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(() => route.kind === "settings" || route.kind === "me");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(() => route.kind === "settings" ? route.section : "appearance");
  const [memoComposerSignal, setMemoComposerSignal] = useState(0);
  const [privateGate, setPrivateGate] = useState(false);
  const [summaryRequest, setSummaryRequest] = useState<{ id: string; token: number } | null>(null);
  const userId = user.id;
  const settingsReturn = useRef<AppRoute>({ kind: "home" });
  const moveNote = useCallback((item: Item) => setOrganizingItem(item), []);
  const toggleNoteStar = useCallback((item: Item) =>
    saveItemMeta(userId, item.id, { starred: !item.starred }), [userId]);
  const openAiSummary = useCallback((item: Item) => {
    if (item.type !== "note" || item.content.scope !== "plain") return;
    setNoteId(item.id);
    setMobilePane("doc");
    navigate(sectionRoute(section, item.id));
    setSummaryRequest({ id: item.id, token: Date.now() });
  }, [navigate, section]);
  const trashNote = useCallback(async (item: Item) => {
    if (!window.confirm(`将「${item.title}」移入回收站？之后可恢复。`)) return;
    await softDeleteItem(userId, item.id);
    if (noteId === item.id) {
      setNoteId(null);
      navigate(sectionRoute(section), true);
    }
  }, [userId, noteId, section, navigate]);

  useEffect(() => {
    const onPopState = () => setRoute(parseAppRoute(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    if (window.location.pathname === "/") navigate({ kind: "home" }, true);
    return () => window.removeEventListener("popstate", onPopState);
  }, [navigate]);

  useEffect(() => {
    setView(route.kind === "status" ? "status" : "main");
    setDrawerOpen(false);
    if (route.kind === "settings") {
      setSettingsOpen(true);
      setSettingsSection(route.section);
      return;
    }
    if (route.kind === "me" && layout !== "mobile") {
      setSettingsOpen(true);
      setSettingsSection("appearance");
      return;
    }
    setSettingsOpen(false);
    if (route.kind === "status") return;
    const nextSection = routeSection(route);
    setSection(nextSection);
    const nextNoteId = route.kind === "notes" ? route.itemId ?? null : null;
    setNoteId(nextNoteId);
    setMobilePane(nextNoteId ? "doc" : "list");
  }, [route, layout]);

  const openNewNote = useCallback(async () => {
    const place = section.kind === "topic" ? section.id : null;
    try {
      const created = await createNoteForPlace(userId, place);
      const next = created.section.kind === "topic" ? created.section : { kind: "drafts" as const };
      setView("main");
      setSection(next);
      setNoteId(created.item.id);
      setMobilePane("doc");
      setDrawerOpen(false);
      navigate(sectionRoute(next, created.item.id));
    } catch (cause) {
      if (cause instanceof Error && cause.message === "private_space_locked") setPrivateGate(true);
    }
  }, [userId, navigate, section]);
  const openMemoComposer = useCallback(() => {
    setCollapsed(false);
    setMemoComposerSignal((value) => value + 1);
    if (layout === "tablet" || layout === "mobile") setDrawerOpen(true);
  }, [layout]);
  const openSettings = useCallback((next: SettingsSection = "backup") => {
    setSettingsSection(next);
    setSettingsOpen(true);
    setDrawerOpen(false);
    settingsReturn.current = route;
    navigate({ kind: "settings", section: next });
  }, [navigate, route]);

  // ⌘/Ctrl 1 回笔记，2 进 Memo。Esc 不承担返回（DESIGN 第 03 屏）。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select"))) return;
      const key = event.key.toLowerCase();
      if (key === "n") {
        event.preventDefault();
        void openNewNote();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        openMemoComposer();
        return;
      }
      if (event.key !== "1" && event.key !== "2") return;
      event.preventDefault();
      if (event.key === "2") {
        setSection((current) => {
          if (current.kind !== "memos") setNoteReturn({ section: current.kind === "home" ? { kind: "recent" } : current, noteId });
          return { kind: "memos" };
        });
        navigate({ kind: "memos" });
      } else {
        const back = noteReturnRef.current;
        setSection(back.section);
        setNoteId(back.noteId);
        navigate(sectionRoute(back.section, back.noteId ?? undefined));
      }
      setView("main");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [noteId, userId, layout, openNewNote, openMemoComposer, navigate]);

  // FR-VER-7 启动兜底：回收超期空白草稿种子（三道闸在服务内实现）。
  useEffect(() => { void sweepBlankDrafts(userId); }, [userId]);
  useEffect(() => { prefetchSettings(userId); }, [userId]);

  // FR-ENC-4 不活动自动锁定（默认 15 分钟）：周期检查，锁定触发全局重渲染。
  useEffect(() => {
    const timer = window.setInterval(() => { lockIfIdle(); }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // G6 同步调度（G2 §3 触发时机）：打开、本地写入后 300ms、重新可见、网络恢复、每 5 分钟。
  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void requestSync(userId); }, 300);
    };
    const off = subscribeLocalChanges(schedule);
    const onVisible = () => { if (document.visibilityState === "visible") void requestSync(userId); };
    const interval = window.setInterval(() => { void requestSync(userId); }, 5 * 60_000);
    window.addEventListener("online", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    void requestSync(userId);
    return () => {
      off();
      window.clearTimeout(timer);
      window.clearInterval(interval);
      window.removeEventListener("online", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId]);

  const topics = useTopics(userId);
  const items = useSectionItems(userId, section);
  const lockVersion = useLockVersion();
  useEffect(() => {
    if (section.kind !== "topic") return;
    const topic = topics.find((row) => row.id === section.id);
    if (!topic) return;
    const root = topic.isEncSpace ? topic : topics.find((row) => row.id === topic.parentId && row.isEncSpace);
    if (root && !isTopicUnlocked(root.id)) {
      setNoteId(null);
      setSection({ kind: "recent" });
      navigate(sectionRoute({ kind: "recent" }), true);
    }
  }, [lockVersion, section, topics, navigate]);

  const account = { username: user.username, role: user.role };
  const shellProps = {
    "data-layout": layout,
    "data-sidebar": collapsed && layout === "compact" ? "collapsed" : "expanded",
    "data-pointer": coarsePointer ? "coarse" : "fine",
  };
  const sidebar = (
    <Sidebar
      userId={userId}
      account={account}
      layout={layout}
      collapsed={collapsed && layout === "compact"}
      drawerOpen={drawerOpen}
      section={section}
      onOpenPrivate={() => setPrivateGate(true)}
      onSelectSection={(next) => {
        setView("main");
        if (next.kind === "memos" && section.kind !== "memos") setNoteReturn({ section: section.kind === "home" ? { kind: "recent" } : section, noteId });
        setSection(next);
        if (next.kind !== "memos") setNoteId(null);
        setMobilePane("list");
        setDrawerOpen(false);
        navigate(sectionRoute(next));
      }}
      onCreateNote={openNewNote}
      onLogout={onLogout}
      onToggleCollapse={() => setCollapsed((value) => !value)}
      onCloseDrawer={() => setDrawerOpen(false)}
      onOpenSettings={() => openSettings()}
      onOpenStatus={() => { navigate({ kind: "status" }); setView("status"); setDrawerOpen(false); }}
      memoComposerSignal={memoComposerSignal}
    />
  );
  const settingsDialog = settingsOpen ? (
    <SettingsDialog
      key={`settings-${settingsSection}`}
      userId={userId}
      initialSection={settingsSection}
      onClose={() => { setSettingsOpen(false); goBack(settingsReturn.current); }}
      onSectionChange={(next) => { setSettingsSection(next); navigate({ kind: "settings", section: next }, true); }}
    />
  ) : null;
  const privateDialog = privateGate ? (
    <PrivateSpaceDialog
      userId={userId}
      onOpened={(topicId) => {
        setPrivateGate(false);
        setView("main");
        const next = { kind: "topic" as const, id: topicId };
        setSection(next);
        setNoteId(null);
        setMobilePane("list");
        setDrawerOpen(false);
        navigate(sectionRoute(next));
      }}
      onCancel={() => setPrivateGate(false)}
    />
  ) : null;

  if (view === "status") {
    return (
      <div className="mn-shell" {...shellProps}>
        {drawerOpen && <div className="mn-overlay" onClick={() => setDrawerOpen(false)} />}
        {sidebar}
        <SystemStatusPage onBack={() => { goBack({ kind: "home" }); setView("main"); }} />
        {settingsDialog}
        {privateDialog}
      </div>
    );
  }

  if (layout === "mobile") {
    return (
      <div className="mn-shell" {...shellProps}>
        <MobileApp user={user} onLogout={onLogout} onOpenSettings={openSettings} onOpenPrivate={() => setPrivateGate(true)} onOpenStatus={() => { navigate({ kind: "status" }); setView("status"); }} route={route} onNavigate={navigate} />
        {settingsDialog}
        {privateDialog}
      </div>
    );
  }

  if (section.kind === "home") {
    return (
      <div className="mn-shell" {...shellProps}>
        {drawerOpen && <div className="mn-overlay" onClick={() => setDrawerOpen(false)} />}
        {sidebar}
        <HomePage
          userId={userId}
          onCreateNote={openNewNote}
          onOpenMemoComposer={openMemoComposer}
          onOpenTodos={() => {
            setNoteReturn({ section: { kind: "recent" }, noteId: null });
            setTodoOpen(true);
            setSection({ kind: "memos" });
            setDrawerOpen(false);
            navigate({ kind: "memos" });
          }}
          onOpenItem={(item) => {
            if (item.type === "memo") {
              setSection({ kind: "memos" });
              setNoteId(null);
              navigate({ kind: "memos", itemId: item.id });
            } else {
              setSection({ kind: "recent" });
              setNoteId(item.id);
              navigate(sectionRoute({ kind: "recent" }, item.id));
            }
            setMobilePane("doc");
            setDrawerOpen(false);
          }}
          onOpenPrivate={() => setPrivateGate(true)}
          onNavigate={(next) => {
            if (next.kind === "memos") setNoteReturn({ section: { kind: "recent" }, noteId: null });
            setSection(next);
            setNoteId(null);
            setMobilePane("list");
            setDrawerOpen(false);
            navigate(sectionRoute(next));
          }}
        />
        {settingsDialog}
        {privateDialog}
      </div>
    );
  }

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
          selectedMemoId={route.kind === "memos" ? route.itemId : undefined}
          onSelectMemo={(id) => navigate({ kind: "memos", itemId: id })}
          onBackToNotes={() => { setSection(noteReturn.section); setNoteId(noteReturn.noteId); navigate(sectionRoute(noteReturn.section, noteReturn.noteId ?? undefined), true); }}
        />
        {settingsDialog}
        {privateDialog}
      </div>
    );
  }

  if (section.kind === "trash") {
    const trashItem = noteId ? items?.find((row) => row.id === noteId) : undefined;
    return (
      <div className="mn-shell" {...shellProps}>
        {drawerOpen && <div className="mn-overlay" onClick={() => setDrawerOpen(false)} />}
        {sidebar}
        <MainLayout
          layout={layout}
          viewMode={viewMode}
          onViewMode={setViewMode}
          title="回收站"
          items={items}
          selectedNoteId={noteId}
          onSelectNote={(id) => { setNoteId(id); setMobilePane("doc"); navigate(sectionRoute(section, id ?? undefined)); }}
          emptyTitle="回收站是空的"
          emptyDetail="移入回收站的内容会出现在这里，可恢复或永久删除。"
          headerExtra={(
            <button type="button" className="mn-textbtn" aria-label="清空回收站"
              onClick={async () => {
                if (!items || items.length === 0 || !window.confirm(`清空回收站（${items.length} 项）？永久删除不可恢复。`)) return;
                await purgeItemsPermanently(userId, items.map((row) => row.id));
                setNoteId(null);
                navigate(sectionRoute(section));
              }}>
              清空回收站
            </button>
          )}
          mobilePane={mobilePane}
          onBackToList={() => { setMobilePane("list"); setNoteId(null); navigate(sectionRoute(section), true); }}
          onOpenDrawer={() => setDrawerOpen(true)}
          document={trashItem ? (
            <TrashItemPanel key={trashItem.id} userId={userId} item={trashItem} onBack={() => { setMobilePane("list"); setNoteId(null); navigate(sectionRoute(section), true); }} showBack={layout === "tablet"} />
          ) : (
            <article className="mn-doc" aria-label="文档区">
              <div className="mn-docbar"><span className="mn-docbar-left"><span className="mn-crumb">回收站</span></span></div>
              <div className="mn-empty" role="status">
                <div>
                  <p className="mn-empty-title">选择一项</p>
                  <p className="mn-empty-detail">恢复或永久删除在选中之后操作。</p>
                </div>
              </div>
            </article>
          )}
        />
        {privateDialog}
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
        onSelectNote={(id) => {
          const selected = items?.find((item) => item.id === id);
          if (selected?.type === "memo") {
            setNoteReturn({ section, noteId: null });
            setSection({ kind: "memos" });
            setNoteId(null);
            navigate({ kind: "memos", itemId: id });
            return;
          }
          setNoteId(id); setMobilePane("doc"); navigate(sectionRoute(section, id ?? undefined));
        }}
        onMoveNote={moveNote}
        onToggleStar={toggleNoteStar}
        onTrashNote={trashNote}
        onAiSummary={openAiSummary}
        emptyTitle={emptyTitle}
        emptyDetail={emptyDetail}
        mobilePane={mobilePane}
        onBackToList={() => { setMobilePane("list"); setNoteId(null); navigate(sectionRoute(section), true); }}
        onOpenDrawer={() => setDrawerOpen(true)}
        document={noteId ? (
          <NoteDocument
            key={noteId}
            userId={userId}
            noteId={noteId}
            topics={topics}
            unfiled={section.kind === "inbox" || section.kind === "drafts"}
            onBack={() => { setMobilePane("list"); setNoteId(null); navigate(sectionRoute(section), true); }}
            showBack={layout === "tablet"}
            crumb={title}
            openSummaryToken={summaryRequest?.id === noteId ? summaryRequest.token : undefined}
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
      {organizingItem && (
        <OrganizeDialog
          item={organizingItem}
          topics={topics}
          allowDelete={false}
          onDone={() => setOrganizingItem(null)}
          onMove={async (topicId, groupId) => {
            await saveItemMeta(userId, organizingItem.id, { topicId, groupId });
          }}
        />
      )}
      {settingsDialog}
      {privateDialog}
    </div>
  );
}
