import { Activity, AlignLeft, Clock, FileText, Inbox, Lock, LogOut, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, SlidersHorizontal, Star } from "lucide-react";
import type { LayoutMode } from "./AppShell";
import { APP_VERSION_LABEL } from "../lib/version";

interface SidebarProps {
  layout: LayoutMode;
  collapsed: boolean;
  drawerOpen: boolean;
  selectedSection: "all" | "inbox" | "drafts";
  account?: { username: string; role: "owner" | "member" };
  onLogout?: () => void;
  onSelectSection: (section: "all" | "inbox" | "drafts") => void;
  onToggleCollapse: () => void;
  onCloseDrawer: () => void;
  onOpenStatus: () => void;
}

/* 侧栏骨架（FR-IA-4 入口顺序；搜索入口未定不放侧栏）。
   主题树、标签在 M2 接入业务后填充；底部账户区来自 G1 会话。 */
export function Sidebar({ layout, collapsed, drawerOpen, selectedSection, account, onLogout, onSelectSection, onToggleCollapse, onCloseDrawer, onOpenStatus }: SidebarProps) {
  const overlayMode = layout === "tablet" || layout === "mobile";
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
      {!collapsed && (
        <button type="button" className="mn-memo-hint" aria-disabled="true" title="Memo 快速记录将在 M2 开放">
          <span className="mn-dot" aria-hidden="true" />
          <span>记一条 Memo…</span>
          {!overlayMode && <span className="mn-kbd">⌘↵</span>}
        </button>
      )}
      <button type="button" className="mn-btn" aria-disabled="true" title="笔记创建将在 M2 开放">
        <Plus />
        {!collapsed && "新建笔记"}
      </button>
      <nav className="mn-nav" aria-label="回看">
        <a href="#" onClick={(event) => event.preventDefault()} aria-disabled="true" title="Memo 时间线将在 M2 开放">
          <AlignLeft />
          {!collapsed && "Memo 时间线"}
        </a>
        <a href="#" onClick={(event) => event.preventDefault()} aria-disabled="true" title="最近编辑将在 M2 开放">
          <Clock />
          {!collapsed && "最近编辑"}
        </a>
        <a href="#" onClick={(event) => event.preventDefault()} aria-disabled="true" title="收藏将在 M2 开放">
          <Star />
          {!collapsed && "收藏"}
        </a>
      </nav>
      <div className="mn-duo">
        <a href="#" onClick={(event) => { event.preventDefault(); onSelectSection("inbox"); }} className={selectedSection === "inbox" ? "on" : ""}>
          <Inbox />
          {!collapsed && "收件箱"}
        </a>
        <a href="#" onClick={(event) => { event.preventDefault(); onSelectSection("drafts"); }} className={selectedSection === "drafts" ? "on" : ""}>
          <FileText />
          {!collapsed && "草稿箱"}
        </a>
      </div>
      {!collapsed && (
        <>
          <div className="mn-seclabel">
            <span className="mn-seclabel-text">主题</span>
            <button type="button" className="mn-minibtn" aria-disabled="true" title="主题管理将在 M2 开放" aria-label="新建主题（未开放）">
              <Plus />
            </button>
          </div>
          <div className="mn-tree">
            <p className="mn-tree-empty">暂无主题</p>
            <a
              href="#"
              className="mn-treerow priv"
              onClick={(event) => event.preventDefault()}
              aria-disabled="true"
              title="私人空间将在 M2 提供解锁"
            >
              <Lock />
              <span>私人空间</span>
              <span className="mn-locklabel">锁定</span>
            </a>
          </div>
          <div className="mn-seclabel">
            <span className="mn-seclabel-text">标签</span>
            <button type="button" className="mn-minibtn" aria-disabled="true" title="标签管理将在 M2 开放" aria-label="管理标签（未开放）">
              <MoreHorizontal />
            </button>
          </div>
          <div className="mn-tags">
            <p className="mn-tree-empty">暂无标签</p>
          </div>
        </>
      )}
      <div className="mn-sb-foot">
        {!collapsed && (
          <span className="mn-foot-account" title={account ? `${account.username}（${account.role === "owner" ? "管理员" : "成员"}）` : undefined}>
            {account?.username ?? "未登录"}
          </span>
        )}
        {account && onLogout && (
          <button type="button" className="mn-iconbtn" aria-label="退出登录" title="退出登录" onClick={onLogout}>
            <LogOut />
          </button>
        )}
        {!collapsed && <span className="mn-foot-version">{APP_VERSION_LABEL}</span>}
        <button type="button" className="mn-iconbtn" aria-label="打开系统状态" title="系统状态与健康检查" onClick={onOpenStatus}>
          <Activity />
        </button>
      </div>
    </aside>
  );
}
