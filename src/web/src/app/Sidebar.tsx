import { Clock, FileText, Home, Inbox, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, Star, StickyNote, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AuthUser } from "@menote/shared";
import type { LayoutMode } from "../lib/layout";
import type { BrowseSection } from "../services/contentHooks";
import { useAllTags, useDrafts, useInbox } from "../services/contentHooks";
import { TopicTree } from "../features/tree";
import { QuickComposer } from "../features/memo";
import { AccountMenu } from "./AccountMenu";
import { TagManagerDialog } from "./TagManagerDialog";
import { SectionHead } from "../components/ui/SectionHead";
import { DEFAULT_WORKSPACE_SETTINGS, readWorkspaceSettings, updateWorkspaceSettings } from "../services/workspaceSettingsService";

interface SidebarProps {
  userId: string;
  account: { username: string; role: "owner" | "member" };
  layout: LayoutMode;
  collapsed: boolean;
  drawerOpen: boolean;
  section: BrowseSection;
  onSelectSection: (section: BrowseSection) => void;
  onOpenPrivate: () => void;
  onDropItem: (itemId: string, topicId: string, groupId: string | null) => void | Promise<unknown>;
  onCreateNote: () => void;
  onLogout: () => void;
  onToggleCollapse: () => void;
  onCloseDrawer: () => void;
  onOpenSettings: () => void;
  onOpenStatus: () => void;
  memoComposerSignal: number;
}

const isSection = (section: BrowseSection, kind: BrowseSection["kind"]): boolean =>
  section.kind === kind;

/* 侧栏（2026-11-03 定稿，DESIGN §4.1 / §5.5 同步）：
   顶部次序不变（品牌 / 视图切换 / 快速输入 / 新建笔记）；一个橙色只出现一次，材质靠 1px 上下内阴影。
   回看三项改为并排三格（无填充，悬停浮底）；收件箱、草稿箱并排两格（凹槽底，收件箱上强调浅底），
   计数右对齐等宽。工作区与内容区之间一条发丝线。
   加密空间独立成行放在主题段之上；「新建主题」收进段标题行。
   树连接线是侧栏唯一的层级线（fg-faint 42%，同时间轴轴线做法）。 */
export function Sidebar({ userId, account, layout, collapsed, drawerOpen, section, onSelectSection, onOpenPrivate, onDropItem, onCreateNote, onLogout, onToggleCollapse, onCloseDrawer, onOpenSettings, onOpenStatus, memoComposerSignal }: SidebarProps) {
  const overlayMode = layout === "tablet" || layout === "mobile";
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WORKSPACE_SETTINGS.sidebarWidth);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    const refresh = () => { void readWorkspaceSettings(userId).then((settings) => {
      setSidebarWidth(settings.sidebarWidth);
      document.documentElement.style.setProperty("--mn-sidebar-width", `${settings.sidebarWidth}px`);
    }); };
    refresh();
    window.addEventListener("menote:workspace-settings", refresh);
    return () => window.removeEventListener("menote:workspace-settings", refresh);
  }, [userId]);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!resizeStart.current) return;
      const width = Math.max(200, Math.min(420, resizeStart.current.width + event.clientX - resizeStart.current.x));
      setSidebarWidth(width);
      document.documentElement.style.setProperty("--mn-sidebar-width", `${width}px`);
    };
    const up = () => {
      const start = resizeStart.current;
      if (!start) return;
      resizeStart.current = null;
      const width = Math.max(200, Math.min(420, sidebarWidthRef.current));
      void updateWorkspaceSettings(userId, { sidebarWidth: width });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [userId]);
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;
  const inbox = useInbox(userId);
  const drafts = useDrafts(userId);
  const tags = useAllTags(userId);

  return (
    <>
    <aside className={overlayMode ? "mn-sidebar mn-drawer" : "mn-sidebar"} data-open={overlayMode ? drawerOpen : undefined} aria-label="侧栏">
      <div className="mn-sb-top">
        {overlayMode && (
          <button type="button" className="mn-iconbtn" aria-label="关闭侧栏" onClick={onCloseDrawer}>
            <PanelLeftClose />
          </button>
        )}
        <span className="mn-brand"><img className="mn-logo" src="/icon.svg" alt="" />{collapsed ? "" : "Menote"}</span>
        <span className="mn-sb-top-actions">
          {(layout === "compact" || layout === "full") && (
            <button type="button" className="mn-iconbtn" aria-label={collapsed ? "展开侧栏" : "折叠侧栏"} onClick={onToggleCollapse}>
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </button>
          )}
        </span>
      </div>
      {!collapsed && (
        <div className="mn-formseg" role="group" aria-label="视图切换">
          <button type="button" aria-pressed={section.kind === "home"} onClick={() => onSelectSection({ kind: "home" })}>
            <Home aria-hidden="true" />首页
          </button>
          <button type="button" aria-pressed={section.kind !== "memos" && section.kind !== "home"} onClick={() => { if (section.kind === "memos" || section.kind === "home") onSelectSection({ kind: "recent" }); }}>
            <FileText aria-hidden="true" />笔记
          </button>
          <button type="button" aria-pressed={isSection(section, "memos")} onClick={() => onSelectSection({ kind: "memos" })}>
            <StickyNote aria-hidden="true" />Memo
          </button>
        </div>
      )}
      {!collapsed && <QuickComposer userId={userId} openSignal={memoComposerSignal} />}
      <button type="button" className="mn-btn" aria-label="新建笔记" title="新建笔记" onClick={onCreateNote}>
        <Plus />
        {!collapsed && <>新建笔记<span className="mn-kbd mn-btn-kbd" aria-hidden="true">⌘N</span></>}
      </button>
      <nav className="mn-quick" aria-label="回看">
        <a href="#" title="最近编辑" aria-label="最近编辑" className={isSection(section, "recent") ? "on" : ""}
          onClick={(event) => { event.preventDefault(); onSelectSection({ kind: "recent" }); }}>
          <Clock />
          {!collapsed && "最近编辑"}
        </a>
        <a href="#" title="收藏" aria-label="收藏" className={isSection(section, "starred") ? "on" : ""}
          onClick={(event) => { event.preventDefault(); onSelectSection({ kind: "starred" }); }}>
          <Star />
          {!collapsed && "收藏"}
        </a>
        <a href="#" title="回收站" aria-label="回收站" className={isSection(section, "trash") ? "on" : ""}
          onClick={(event) => { event.preventDefault(); onSelectSection({ kind: "trash" }); }}>
          <Trash2 />
          {!collapsed && "回收站"}
        </a>
      </nav>
      <div className="mn-queue" role="group" aria-label="收集入口">
        <a href="#" title="收件箱" aria-label={`收件箱${inbox.length ? `，${inbox.length} 条` : ""}`} className={isSection(section, "inbox") ? "on hot" : "hot"}
          onClick={(event) => { event.preventDefault(); onSelectSection({ kind: "inbox" }); }}>
          <Inbox />
          {!collapsed && <span>收件箱</span>}
          {!collapsed && inbox.length > 0 && <span className="mn-count">{inbox.length}</span>}
        </a>
        <a href="#" title="草稿箱" aria-label={`草稿箱${drafts.length ? `，${drafts.length} 条` : ""}`} className={isSection(section, "drafts") ? "on" : ""}
          onClick={(event) => { event.preventDefault(); onSelectSection({ kind: "drafts" }); }}>
          <FileText />
          {!collapsed && <span>草稿箱</span>}
          {!collapsed && drafts.length > 0 && <span className="mn-count">{drafts.length}</span>}
        </a>
      </div>
      {!collapsed && <div className="mn-zone" aria-hidden="true" />}
      {!collapsed && (
        <TopicTree userId={userId} selected={section} onSelect={onSelectSection} onOpenPrivate={onOpenPrivate} onDropItem={onDropItem} />
      )}
      {!collapsed && (
        <SectionHead
          label="标签"
          action={{
            label: "管理标签",
            icon: <MoreHorizontal aria-hidden="true" />,
            onClick: () => setTagManagerOpen(true),
          }}
        />
      )}
      {!collapsed && (
        <div className="mn-tags">
          {tags.length === 0 && <p className="mn-tree-empty">暂无标签</p>}
          {tags.map((tag) => (
            <a key={tag} href="#" className={section.kind === "tag" && section.tag === tag ? "mn-taglink on" : "mn-taglink"}
              onClick={(event) => { event.preventDefault(); onSelectSection({ kind: "tag", tag }); }}>
              #{tag}
            </a>
          ))}
        </div>
      )}
      <div className="mn-sb-foot">
        <AccountMenu userId={userId} username={account.username} role={account.role} collapsed={collapsed} onLogout={onLogout} onOpenSettings={onOpenSettings} onOpenStatus={onOpenStatus} />
      </div>
      {!overlayMode && !collapsed && <div className="mn-sidebar-resize" role="separator" aria-orientation="vertical" aria-label="调整侧栏宽度" tabIndex={0}
        onPointerDown={(event) => { resizeStart.current = { x: event.clientX, width: sidebarWidth }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerUp={() => { if (resizeStart.current) { resizeStart.current = null; void updateWorkspaceSettings(userId, { sidebarWidth: sidebarWidthRef.current }); } }}
        onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); const next = Math.max(200, Math.min(420, sidebarWidth + (event.key === "ArrowRight" ? 16 : -16))); setSidebarWidth(next); void updateWorkspaceSettings(userId, { sidebarWidth: next }); } }} />}
    </aside>
    {tagManagerOpen && <TagManagerDialog userId={userId} onClose={() => setTagManagerOpen(false)} />}
    </>
  );
}
