import { Clock, FileText, Home, Inbox, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, Star, StickyNote, Trash2 } from "lucide-react";
import type { AuthUser } from "@menote/shared";
import type { LayoutMode } from "../lib/layout";
import type { BrowseSection } from "../services/contentHooks";
import { useAllTags, useDrafts, useInbox } from "../services/contentHooks";
import { TopicTree } from "../features/tree";
import { QuickComposer } from "../features/memo";
import { AccountMenu } from "./AccountMenu";

interface SidebarProps {
  userId: string;
  account: { username: string; role: "owner" | "member" };
  layout: LayoutMode;
  collapsed: boolean;
  drawerOpen: boolean;
  section: BrowseSection;
  onSelectSection: (section: BrowseSection) => void;
  onOpenPrivate: () => void;
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

/* 侧栏（负责人 2026-11-01 定序：搜索 / 视图切换 / 快速输入 / 新建笔记 / 最近编辑 / 收件箱草稿箱 / 主题树 / 标签）。
   视图切换按 DESIGN §5.5 为「首页 | 笔记 | Memo」，置顶在快速输入之上——形态是目的地，应先于输入被看见。
   视图切换 2026-11-02 起为凹槽分段 + 图标（负责人反馈文字标签太弱、不显眼），同步 DESIGN §5.5。
   搜索入口为轻量命令行形式（无边框、无底色），与快速输入的输入框形态明显区分；搜索功能尚未实现，入口先禁用。
   首页整屏由 app/HomePage 接入。私人空间入口可设置密码或解锁（FR-ENC-1）。
   版本号移到脚部用户名旁（悬停显构建 id）。 */
export function Sidebar({ userId, account, layout, collapsed, drawerOpen, section, onSelectSection, onOpenPrivate, onCreateNote, onLogout, onToggleCollapse, onCloseDrawer, onOpenSettings, onOpenStatus, memoComposerSignal }: SidebarProps) {
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
      <button type="button" className="mn-btn" onClick={onCreateNote}>
        <Plus />
        {!collapsed && "新建笔记"}
      </button>
      <nav className="mn-nav" aria-label="回看">
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
          <TopicTree userId={userId} selected={section} onSelect={onSelectSection} onOpenPrivate={onOpenPrivate} />
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
        <AccountMenu userId={userId} username={account.username} role={account.role} collapsed={collapsed} onLogout={onLogout} onOpenSettings={onOpenSettings} onOpenStatus={onOpenStatus} />
      </div>
    </aside>
  );
}
