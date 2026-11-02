import { useMemo, useState } from "react";
import { ArrowUpRight, Bolt, FilePlus2, LockKeyhole, Search, Tags } from "lucide-react";
import type { Item, TopicNode } from "@menote/shared";
import type { BrowseSection } from "../services/contentHooks";
import { useHomeSnapshot, useRecentItems } from "../services/contentHooks";

interface HomePageProps {
  userId: string;
  onCreateNote: () => void;
  onOpenMemoComposer: () => void;
  onOpenTodos: () => void;
  onOpenItem: (item: Item) => void;
  onNavigate: (section: BrowseSection) => void;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "昨天";
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function topicPath(topicId: string | null, topics: TopicNode[]): string {
  if (!topicId) return "未归类";
  const topic = topics.find((row) => row.id === topicId);
  if (!topic || topic.isEncSpace) return "私人空间";
  if (!topic.parentId) return topic.name;
  const parent = topics.find((row) => row.id === topic.parentId);
  return parent ? `${parent.name} › ${topic.name}` : topic.name;
}

function countTopicItems(topic: TopicNode, topics: TopicNode[], items: Item[]): number {
  const childIds = new Set(topics.filter((row) => row.parentId === topic.id).map((row) => row.id));
  childIds.add(topic.id);
  return items.filter((item) => item.type !== "memo" && item.topicId !== null && childIds.has(item.topicId)).length;
}

export function HomePage({ userId, onCreateNote, onOpenMemoComposer, onOpenTodos, onOpenItem, onNavigate }: HomePageProps) {
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [allTopicsOpen, setAllTopicsOpen] = useState(false);
  const snapshot = useHomeSnapshot(userId);
  const recent = useRecentItems(userId);
  const notes = snapshot.items.filter((item) => item.type !== "memo");
  const inboxCount = notes.filter((item) => item.topicId === null && item.source !== "manual").length;
  const draftCount = notes.filter((item) => item.topicId === null && item.source === "manual").length;
  const starredCount = snapshot.items.filter((item) => item.starred).length;
  const todoCount = snapshot.items.filter((item) => item.type === "memo" && (item.status === "todo" || item.status === "doing")).length;
  const topics = snapshot.topics.filter((topic) => !topic.isEncSpace && topic.parentId === null);
  const privateRootIds = new Set(snapshot.topics.filter((topic) => topic.isEncSpace).map((topic) => topic.id));
  const privateTopicIds = new Set(snapshot.topics.filter((topic) => topic.isEncSpace || (topic.parentId !== null && privateRootIds.has(topic.parentId))).map((topic) => topic.id));
  const visibleRecent = recent.filter((item) => !item.topicId || !privateTopicIds.has(item.topicId)).slice(0, 5);
  const dateTitle = useMemo(() => new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric" }), []);
  const weekday = useMemo(() => new Date().toLocaleDateString("zh-CN", { weekday: "long" }), []);
  const visibleTags = [...new Set(snapshot.items.filter((item) => item.type === "memo" || !item.topicId || !privateTopicIds.has(item.topicId)).flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b));

  return (
    <main className="mn-home" aria-label="首页">
      <header className="mn-home-bar">
        <div className="mn-home-heading">
          <h1>{dateTitle}</h1>
          <span className="mn-home-sub">{weekday} · 本地有 {notes.length} 篇笔记</span>
        </div>
        <button type="button" className="mn-home-search" disabled title="搜索功能尚未开放">
          <Search aria-hidden="true" /><span>搜索一切</span><kbd>⌘K</kbd>
        </button>
      </header>

      <div className="mn-home-content">
        <section className="mn-home-section" aria-labelledby="home-actions-title">
          <h2 id="home-actions-title" className="mn-home-section-title">行动</h2>
          <div className="mn-home-actions">
            <button type="button" className="mn-home-action" onClick={onOpenMemoComposer}>
              <span className="mn-home-dot" aria-hidden="true" />
              <span className="mn-home-action-copy"><strong>记一条 Memo</strong><small>随手一笔，不进文档</small></span>
              <kbd>⌘↵</kbd>
            </button>
            <button type="button" className="mn-home-action" onClick={onCreateNote}>
              <FilePlus2 aria-hidden="true" />
              <span className="mn-home-action-copy"><strong>新建笔记</strong><small>正式文档，先写再分类</small></span>
              <kbd>⌘N</kbd>
            </button>
            <button type="button" className="mn-home-action is-disabled" disabled title="搜索功能尚未开放">
              <Search aria-hidden="true" />
              <span className="mn-home-action-copy"><strong>搜索一切</strong><small>主题 / 笔记 / Memo / 标签</small></span>
              <kbd>⌘K</kbd>
            </button>
          </div>
        </section>

        <section className="mn-home-section" aria-labelledby="home-status-title">
          <h2 id="home-status-title" className="mn-home-section-title">状态</h2>
          <div className="mn-home-stats">
            <button type="button" className="mn-home-stat is-accent" onClick={() => onNavigate({ kind: "inbox" })}>
              <span className="mn-home-stat-label">收件箱</span><strong>{inboxCount}</strong><small>外部采集与 Agent 输入</small>
            </button>
            <button type="button" className="mn-home-stat" onClick={() => onNavigate({ kind: "drafts" })}>
              <span className="mn-home-stat-label">草稿箱</span><strong>{draftCount}</strong><small>自建未归类</small>
            </button>
            <button type="button" className="mn-home-stat" onClick={() => onNavigate({ kind: "starred" })}>
              <span className="mn-home-stat-label">收藏</span><strong>{starredCount}</strong><small>标记过的笔记</small>
            </button>
            <button type="button" className="mn-home-stat" onClick={onOpenTodos}>
              <span className="mn-home-stat-label">Memo 待办</span><strong>{todoCount}</strong><small>待办与进行中的任务</small>
            </button>
          </div>
        </section>

        <section className="mn-home-section" aria-labelledby="home-recent-title">
          <div className="mn-home-section-title-row"><h2 id="home-recent-title" className="mn-home-section-title">最近编辑</h2>
            <button type="button" className="mn-home-more" onClick={() => onNavigate({ kind: "recent" })}>全部 ›</button></div>
          <div className="mn-home-recent">
            {visibleRecent.length ? visibleRecent.map((item) => (
              <button type="button" className="mn-home-recent-row" key={item.id} onClick={() => onOpenItem(item)}>
                <span className="mn-home-recent-copy"><strong>{item.title || "无标题"}</strong><small>{topicPath(item.topicId, snapshot.topics)}</small></span>
                <time>{formatTime(item.updatedAt)}</time>
              </button>
            )) : <p className="mn-home-empty">还没有编辑过的笔记</p>}
          </div>
        </section>

        <section className="mn-home-section" aria-labelledby="home-topics-title">
          <div className="mn-home-section-title-row"><h2 id="home-topics-title" className="mn-home-section-title">主题速览</h2>
            <button type="button" className="mn-home-more" aria-expanded={allTopicsOpen} onClick={() => setAllTopicsOpen((open) => !open)}>{allTopicsOpen ? "收起" : "全部主题 ›"}</button></div>
          <div className="mn-home-topics">
            {(allTopicsOpen ? topics : topics.slice(0, 6)).map((topic) => (
              <button type="button" className="mn-home-topic" key={topic.id} onClick={() => onNavigate({ kind: "topic", id: topic.id })}>
                {topic.name}<span>{countTopicItems(topic, snapshot.topics, snapshot.items)}</span>
              </button>
            ))}
            {snapshot.topics.some((topic) => topic.isEncSpace) && <span className="mn-home-topic is-private"><LockKeyhole aria-hidden="true" />私人空间</span>}
            {!topics.length && <p className="mn-home-empty">还没有主题</p>}
          </div>
        </section>

        <nav className="mn-home-links" aria-label="更多浏览方式">
          <div className="mn-home-link-group">
            <button type="button" aria-expanded={tagMenuOpen} onClick={() => setTagMenuOpen((open) => !open)}>
              <Tags aria-hidden="true" />按标签浏览<ArrowUpRight aria-hidden="true" />
            </button>
            {tagMenuOpen && <div className="mn-home-tag-menu" role="menu" aria-label="选择标签">
              {visibleTags.length ? visibleTags.map((tag) => <button type="button" role="menuitem" key={tag} onClick={() => { onNavigate({ kind: "tag", tag }); setTagMenuOpen(false); }}>#{tag}</button>) : <span>暂无标签</span>}
            </div>}
          </div>
          <button type="button" onClick={() => onNavigate({ kind: "memos" })}><Bolt aria-hidden="true" />回顾与随机漫步<ArrowUpRight aria-hidden="true" /></button>
          <button type="button" onClick={() => onNavigate({ kind: "memos" })}><span className="mn-home-link-mark" aria-hidden="true">M</span>全部 Memo<ArrowUpRight aria-hidden="true" /></button>
        </nav>
      </div>
    </main>
  );
}
