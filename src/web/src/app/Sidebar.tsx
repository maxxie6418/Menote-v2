import { AlignLeft, Clock, FileText, Inbox, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, Star, Trash2 } from "lucide-react";
import type { AuthUser } from "@menote/shared";
import type { LayoutMode } from "../lib/layout";
import type { BrowseSection } from "../services/contentHooks";
import { useAllTags, useDrafts, useInbox } from "../services/contentHooks";
import { TopicTree } from "../features/tree";
import { QuickComposer } from "../features/memo";
import { APP_BUILD_LABEL, APP_VERSION_LABEL } from "../lib/version";
import { AccountMenu } from "./AccountMenu";

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
  onOpenSettings: () => void;
}

const isSection = (section: BrowseSection, kind: BrowseSection["kind"]): boolean =>
  section.kind === kind;

/* 侧栏（FR-IA-4 顺序：快速输入 / 新建笔记 / Memo 时间线 / 最近编辑 / 收件箱草稿箱 / 主题树 / 标签）。
   搜索入口仍未定不放侧栏（E5 后置）；私人空间固定入口保持锁定态（G7）。
   负责人 2026-11-01：品牌旁仅显版本号（悬停显构建 id）；脚部只留账户菜单（主题/设置/退出），
   同步与系统状态归集进设置弹层的状态预览节。 */
export function Sidebar({ userId, account, layout, collapsed, drawerOpen, section, onSelectSection, onCreateNote, onLogout, onToggleCollapse, onCloseDrawer, onOpenSettings }: SidebarProps) {
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
        <span className="mn-brand"><img className="mn-logo" src="/icon.svg" alt="" />{collapsed ? "" : "Menote"}{!collapsed && <span className="mn-brand-version" title={APP_BUILD_LABEL}>{APP_VERSION_LABEL}</span>}</span>
        <span className="mn-sb-top-actions">
          {(layout === "compact" || layout === "full") && (
            <button type="button" className="mn-iconbtn" aria-label={collapsed ? "展开侧栏" : "折叠侧栏"} onClick={onToggleCollapse}>
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </button>
          )}
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
        <AccountMenu username={account.username} role={account.role} collapsed={collapsed} onLogout={onLogout} onOpenSettings={onOpenSettings} />
      </div>
    </aside>
  );
}
