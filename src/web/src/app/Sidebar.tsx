import { Activity, AlignLeft, Clock, FileText, Inbox, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, SlidersHorizontal, Star } from "lucide-react";
import type { LayoutMode } from "./AppShell";
import { TopicTree } from "../tree/TopicTree";
import { DEMO_NOTICE, demoTags, demoTopics } from "../lib/demoData";

interface SidebarProps {
  layout: LayoutMode;
  collapsed: boolean;
  drawerOpen: boolean;
  selectedTopicId: string;
  onSelectTopic: (topicId: string) => void;
  onToggleCollapse: () => void;
  onCloseDrawer: () => void;
  onOpenStatus: () => void;
}

const demoNavCounts = { memo: 24, starred: 6, inbox: 3, drafts: 2 };

export function Sidebar({ layout, collapsed, drawerOpen, selectedTopicId, onSelectTopic, onToggleCollapse, onCloseDrawer, onOpenStatus }: SidebarProps) {
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
          {!collapsed && <>Memo 时间线<span className="mn-cnt plain">{demoNavCounts.memo}</span></>}
        </a>
        <a href="#" onClick={(event) => event.preventDefault()} aria-disabled="true" title="最近编辑将在 M2 开放">
          <Clock />
          {!collapsed && "最近编辑"}
        </a>
        <a href="#" onClick={(event) => event.preventDefault()} aria-disabled="true" title="收藏将在 M2 开放">
          <Star />
          {!collapsed && <>收藏<span className="mn-cnt plain">{demoNavCounts.starred}</span></>}
        </a>
      </nav>
      <div className="mn-duo">
        <a href="#" onClick={(event) => { event.preventDefault(); onSelectTopic("inbox"); }} className={selectedTopicId === "inbox" ? "on" : ""}>
          <Inbox />
          {!collapsed && <>收件箱<span className="mn-cnt">{demoNavCounts.inbox}</span></>}
        </a>
        <a href="#" onClick={(event) => { event.preventDefault(); onSelectTopic("drafts"); }} className={selectedTopicId === "drafts" ? "on" : ""}>
          <FileText />
          {!collapsed && <>草稿箱<span className="mn-cnt plain">{demoNavCounts.drafts}</span></>}
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
          <TopicTree topics={demoTopics} selectedTopicId={selectedTopicId} onSelectTopic={onSelectTopic} />
          <div className="mn-seclabel">
            <span className="mn-seclabel-text">标签</span>
            <button type="button" className="mn-minibtn" aria-disabled="true" title="标签管理将在 M2 开放" aria-label="管理标签（未开放）">
              <MoreHorizontal />
            </button>
          </div>
          <div className="mn-tags">
            {demoTags.map((tag) => (
              <a key={tag.name} href="#" className="mn-tagchip" onClick={(event) => event.preventDefault()} aria-disabled="true" title="标签筛选将在 M2 开放">
                <span className="mn-taghash">#</span>
                {tag.name}
                <span className="mn-tagcount">{tag.count}</span>
              </a>
            ))}
            <a href="#" className="mn-tagchip more" onClick={(event) => event.preventDefault()} aria-disabled="true" title="标签筛选将在 M2 开放">
              全部标签 ›
            </a>
          </div>
        </>
      )}
      <div className="mn-sb-foot">
        <span className="mn-avatar" aria-hidden="true">M</span>
        {!collapsed && <span>maxxie</span>}
        {!collapsed && <span className="mn-demo-chip">{DEMO_NOTICE}</span>}
        <button type="button" className="mn-iconbtn" aria-label="打开系统状态" title="系统状态与健康检查" onClick={onOpenStatus}>
          <Activity />
        </button>
      </div>
    </aside>
  );
}
