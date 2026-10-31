import { Activity, AlignLeft, Clock, FileText, Inbox, LogOut, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, SlidersHorizontal, Star, Trash2 } from "lucide-react";
import type { AuthUser } from "@menote/shared";
import type { LayoutMode } from "./AppShell";
import type { BrowseSection } from "../services/contentHooks";
import { useAllTags, useDrafts, useInbox } from "../services/contentHooks";
import { TopicTree } from "../features/tree";
import { QuickComposer } from "../features/memo";
import { APP_VERSION_LABEL } from "../lib/version";
import { SyncBadge } from "../features/sync";

interface SidebarProps {
  userId: string;
  account: { username: string; role: "owner" | "member" };
  layout: LayoutMode;
  collapsed: boolean;
  drawerOpen: boolean;
  section: BrowseSection;
  onSelectSection: (section: BrowseSection) => void;
  onCreateNote: () => void;
  onLogout: () => void;
  onToggleCollapse: () => void;
  onCloseDrawer: () => void;
  onOpenStatus: () => void;
}

const isSection = (section: BrowseSection, kind: BrowseSection["kind"]): boolean =>
  section.kind === kind;

/* 侧栏（FR-IA-4 顺序：快速输入 / 新建笔记 / Memo 时间线 / 最近编辑 / 收件箱草稿箱 / 主题树 / 标签）。
   搜索入口仍未定不放侧栏（E5 后置）；私人空间固定入口保持锁定态（G7）。 */
export function Sidebar({ userId, account, layout, collapsed, drawerOpen, section, onSelectSection, onCreateNote, onLogout, onToggleCollapse, onCloseDrawer, onOpenStatus }: SidebarProps) {
  const overlayMode = layout === "tablet" || layout === "mobile";
  const inbox = useInbox(userId);
  const drafts = useDrafts(userId);
  const tags = useAllTags(userId);

  return (
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
          <button type="button" className="mn-iconbtn" aria-disabled="true" title="设置将在后续版本开放" aria-label="设置（未开放）">
            <SlidersHorizontal />
          </button>
        </span>
      </div>
      {!collapsed && <QuickComposer userId={userId} />}
      <button type="button" className="mn-btn" onClick={onCreateNote}>
        <Plus />
        {!collapsed && "新建笔记"}
      </button>
      <nav className="mn-nav" aria-label="回看">
        <a href="#" className={isSection(section, "memos") ? "on" : ""}
          onClick={(event) => { event.preventDefault(); onSelectSection({ kind: "memos" }); }}>
          <AlignLeft />
          {!collapsed && "Memo 时间线"}
        </a>
        <a href="#" className={isSection(section, "recent") ? "on" : ""}
          onClick={(event) => { event.preventDefault(); onSelectSection({ kind: "recent" }); }}>
          <Clock />
          {!collapsed && "最近编辑"}
        </a>
        <a href="#" className={isSection(section, "starred") ? "on" : ""}
          onClick={(event) => { event.preventDefault(); onSelectSection({ kind: "starred" }); }}>
          <Star />
          {!collapsed && "收藏"}
        </a>
        <a href="#" className={isSection(section, "trash") ? "on" : ""}
          onClick={(event) => { event.preventDefault(); onSelectSection({ kind: "trash" }); }}>
          <Trash2 />
          {!collapsed && "回收站"}
        </a>
      </nav>
      <div className="mn-duo" role="group" aria-label="收集入口">
        <a href="#" className={isSection(section, "inbox") ? "on" : ""}
          onClick={(event) => { event.preventDefault(); onSelectSection({ kind: "inbox" }); }}>
          <Inbox />
          {!collapsed && <span>收件箱{inbox.length > 0 ? ` · ${inbox.length}` : ""}</span>}
        </a>
        <a href="#" className={isSection(section, "drafts") ? "on" : ""}
          onClick={(event) => { event.preventDefault(); onSelectSection({ kind: "drafts" }); }}>
          <FileText />
          {!collapsed && <span>草稿箱{drafts.length > 0 ? ` · ${drafts.length}` : ""}</span>}
        </a>
      </div>
      {!collapsed && (
        <>
          <div className="mn-seclabel"><span className="mn-seclabel-text">主题</span></div>
          <TopicTree userId={userId} selected={section} onSelect={onSelectSection} />
          <div className="mn-seclabel">
            <span className="mn-seclabel-text">标签</span>
            <button type="button" className="mn-minibtn" aria-disabled="true" title="标签管理将在后续版本开放" aria-label="管理标签（未开放）">
              <MoreHorizontal />
            </button>
          </div>
          <div className="mn-tags">
            {tags.length === 0 && <p className="mn-tree-empty">暂无标签</p>}
            {tags.map((tag) => (
              <a key={tag} href="#" className={section.kind === "tag" && section.tag === tag ? "mn-taglink on" : "mn-taglink"}
                onClick={(event) => { event.preventDefault(); onSelectSection({ kind: "tag", tag }); }}>
                #{tag}
              </a>
            ))}
          </div>
        </>
      )}
      <div className="mn-sb-foot">
        {!collapsed && (
          <span className="mn-foot-account" title={`${account.username}（${account.role === "owner" ? "管理员" : "成员"}）`}>
            {account.username}
          </span>
        )}
        <button type="button" className="mn-iconbtn" aria-label="退出登录" title="退出登录" onClick={onLogout}>
          <LogOut />
        </button>
        {!collapsed && (
          <>
            <SyncBadge />
            <span className="mn-foot-version">{APP_VERSION_LABEL}</span>
          </>
        )}
        <button type="button" className="mn-iconbtn" aria-label="打开系统状态" title="系统状态与健康检查" onClick={onOpenStatus}>
          <Activity />
        </button>
      </div>
    </aside>
  );
}
