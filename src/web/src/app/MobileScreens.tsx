import { useEffect, useRef, useState } from "react";
import { Archive, ArrowLeft, ChevronDown, ChevronRight, Clock3, FileText, Folder, Inbox, LockKeyhole, MoreHorizontal, Plus, Search, Settings, Tag, UserRound, X } from "lucide-react";
import type { Item } from "@menote/shared";
import { useHomeSnapshot, useLocalSearch, useLockVersion, useMemos, usePendingOutboxCount, useSectionItems, useTopics, type BrowseSection } from "../services/contentHooks";
import { isTopicUnlocked } from "../services/keyringService";
import { alwaysHiddenPrivateTopicIds, hiddenPrivateTopicIds } from "../services/privateSpaceService";
import { filterItems } from "../services/searchService";
import { groupByDay, memoImages, statusLabel, MemoGallery } from "../features/memo";
import { NoteDocument } from "../features/notes";
import { MarkdownView } from "../features/markdown";
import { saveItemContent, saveItemMeta } from "../services/contentService";
import { setTaskCheckbox } from "../lib/markdownTasks";
import { SyncBadge } from "../features/sync";
import type { SettingsSection } from "../features/settings";

export type MobilePage = "home" | "memo" | "notes" | "me";
export type NoteSection = { kind: "recent" | "inbox" | "drafts" | "starred" | "trash" } | { kind: "topic"; id: string } | { kind: "tag"; tag: string };

const dateLabel = (timestamp: number) => {
  const date = new Date(timestamp);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })
    : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
};

const previewText = (item: Item) => item.content.scope === "plain"
  ? item.content.markdown.replace(/[#>*`\-\[\]!]/g, "").replace(/\s+/g, " ").trim().slice(0, 64)
  : "已加密";

export function MobileHome({ userId, onOpenItem, onOpenSection }: {
  userId: string; onOpenItem: (item: Item) => void; onOpenSection: (section: NoteSection) => void;
}) {
  const [query, setQuery] = useState("");
  const hits = useLocalSearch(userId, query);
  const searching = query.trim().length > 0;
  const { items, topics } = useHomeSnapshot(userId);
  const hidden = alwaysHiddenPrivateTopicIds(topics);
  const visible = items.filter((item) => !item.topicId || !hidden.has(item.topicId));
  const favorites = visible.filter((item) => item.starred).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
  const recent = [...visible].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12);
  const inbox = visible.filter((item) => item.type !== "memo" && item.topicId === null && item.source !== "manual").length;
  const drafts = visible.filter((item) => item.type !== "memo" && item.topicId === null && item.source === "manual").length;

  return (
    <div className="m-home">
      <header className="m-topbar"><span className="m-brand"><img src="/icon.svg" alt="" />Menote</span></header>
      <label className="m-search"><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、正文、标签" aria-label="搜索标题、正文、标签" /></label>
      {searching ? <div className="m-rlist">
        {hits === undefined ? <p className="m-empty">正在查找…</p>
          : hits.length ? hits.map((hit) => <MobileItemRow key={hit.item.id} item={hit.item} onOpen={() => onOpenItem(hit.item)} />)
            : <p className="m-empty">没有匹配的内容</p>}
      </div> : favorites.length > 0 && <>
        <div className="m-sechead"><b>收藏</b><button type="button" onClick={() => onOpenSection({ kind: "starred" })}>全部 <ChevronRight /></button></div>
        <div className="m-cardrail">
          {favorites.map((item) => <button type="button" className="m-ncard" key={item.id} onClick={() => onOpenItem(item)}>
            <b>{item.title || "无标题"}</b><em>{previewText(item)}</em><span className="meta">{item.type === "memo" ? "MEMO" : "NOTE"} · {dateLabel(item.updatedAt)}</span>
          </button>)}
        </div>
      </>}
      {!searching && <>
      <div className="m-sechead"><b>最近</b><button type="button" onClick={() => onOpenSection({ kind: "recent" })}>全部 <ChevronRight /></button></div>
      <div className="m-rlist">
        {recent.length ? recent.map((item) => <MobileItemRow key={item.id} item={item} onOpen={() => onOpenItem(item)} />)
          : <p className="m-empty">还没有内容，点中间的记录键开始记一条。</p>}
      </div>
      <div className="m-dock"><div className="m-duo">
        <button type="button" onClick={() => onOpenSection({ kind: "inbox" })}><Inbox />收件箱<em>{inbox}</em></button>
        <button type="button" onClick={() => onOpenSection({ kind: "drafts" })}><FileText />草稿箱<em>{drafts}</em></button>
      </div></div>
      </>}
    </div>
  );
}

export function MobileMemo({ userId, onLongPress, onOpenMemo, selectedId, initialTab = "all" }: {
  userId: string; onLongPress: (item: Item) => void; onOpenMemo: (id: string) => void; selectedId?: string | null; initialTab?: "all" | "todo" | "gallery";
}) {
  const memos = useMemos(userId);
  const [tab, setTab] = useState<"all" | "todo" | "gallery">(initialTab);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(["done"]));
  const images = memoImages(memos);
  const counts = { todo: memos.filter((memo) => memo.status === "todo").length, doing: memos.filter((memo) => memo.status === "doing").length, done: memos.filter((memo) => memo.status === "done").length };

  useEffect(() => setTab(initialTab), [initialTab]);

  useEffect(() => {
    if (!selectedId) return;
    window.setTimeout(() => document.getElementById(`memo-${selectedId}`)?.scrollIntoView({ block: "center" }), 0);
  }, [selectedId, memos]);

  const goMemo = (id: string) => {
    setTab("all");
    onOpenMemo(id);
  };

  return (
    <div className="m-screen m-memo-screen">
      <div className="m-filters" role="tablist" aria-label="Memo 视图">
        <button type="button" role="tab" aria-selected={tab === "all"} onClick={() => setTab("all")}>全部</button>
        <button type="button" role="tab" aria-selected={tab === "todo"} onClick={() => setTab("todo")}>待办<em>{counts.todo + counts.doing}</em></button>
        <button type="button" role="tab" aria-selected={tab === "gallery"} onClick={() => setTab("gallery")}>图册<em>{images.length}</em></button>
      </div>
      {tab === "gallery" ? <div className="m-gallery"><MemoGallery images={images} onOpen={goMemo} /></div>
        : tab === "all" ? <div className="m-stream">
          {memos.length ? groupByDay(memos).map((group) => <section key={group.label}>
            <div className="m-day"><b>{group.label}</b><i /></div>
            {group.memos.map((memo) => <MobileMemoRow key={memo.id} memo={memo} userId={userId} onLongPress={onLongPress} />)}
          </section>) : <p className="m-empty">还没有 Memo，点底部记录键随手记下。</p>}
        </div> : <div className="m-stream m-todos">
          {([ ["todo", "待办"], ["doing", "进行中"], ["done", "已完成"] ] as const).map(([status, label]) => {
            const rows = memos.filter((memo) => memo.status === status);
            const isCollapsed = collapsed.has(status);
            return <section key={status}>
              <button type="button" className="m-todo-head" aria-expanded={!isCollapsed} onClick={() => setCollapsed((old) => {
                const next = new Set(old); if (next.has(status)) next.delete(status); else next.add(status); return next;
              })}>{label}<span>{rows.length}</span><ChevronDown /></button>
              {!isCollapsed && rows.map((memo) => <MobileMemoRow key={memo.id} memo={memo} userId={userId} onLongPress={onLongPress} compact />)}
            </section>;
          })}
        </div>}
    </div>
  );
}

function MobileMemoRow({ memo, userId, onLongPress, compact = false }: { memo: Item; userId: string; onLongPress: (item: Item) => void; compact?: boolean }) {
  const timer = useRef<number | undefined>(undefined);
  const markdown = memo.content.scope === "plain" ? memo.content.markdown : "";
  const stopHold = () => { window.clearTimeout(timer.current); };
  const startHold = () => { timer.current = window.setTimeout(() => { onLongPress(memo); }, 480); };

  return <article id={`memo-${memo.id}`} className={`m-memo${compact ? " compact" : ""}`} onPointerDown={startHold} onPointerUp={stopHold} onPointerLeave={stopHold} onPointerCancel={stopHold} onContextMenu={(event) => { event.preventDefault(); onLongPress(memo); }}>
    {memo.content.scope === "plain" ? <div className="m-memo-prose"><MarkdownView markdown={markdown} onToggleTask={(ordinal, checked) => {
      const next = setTaskCheckbox(markdown, ordinal, checked); if (next !== markdown) void saveItemContent(userId, memo.id, next);
    }} /></div> : <p>已加密</p>}
    <div className="m-meta"><time>{new Date(memo.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}</time>
      {memo.content.scope === "plain" && memo.tags.slice(0, 2).map((tag) => <span className="chip" key={tag}>#{tag}</span>)}
      {statusLabel(memo.status) && <span className="st"><i />{statusLabel(memo.status)}</span>}
      <button className="more" type="button" aria-label="更多操作" onClick={() => onLongPress(memo)}><MoreHorizontal /></button>
    </div>
  </article>;
}

export function MobileNotes({ userId, section, selectedId, onSelect, onTopicSheet, onCreate, onLongPress }: {
  userId: string; section: NoteSection; selectedId: string | null;
  onSelect: (item: Item | null) => void; onTopicSheet: () => void; onCreate: () => void; onLongPress: (item: Item) => void;
}) {
  const [query, setQuery] = useState("");
  const topics = useTopics(userId);
  const rows = useSectionItems(userId, section) ?? [];
  const hidden = alwaysHiddenPrivateTopicIds(topics);
  const visible = rows.filter((item) => !item.topicId || !hidden.has(item.topicId));
  const items = filterItems(visible, query);
  const selected = items.find((item) => item.id === selectedId);
  const title = section.kind === "topic" ? topics.find((topic) => topic.id === section.id)?.name ?? "主题"
    : section.kind === "tag" ? `#${section.tag}` : ({ recent: "最近", inbox: "收件箱", drafts: "草稿箱", starred: "收藏", trash: "回收站" }[section.kind]);

  if (selected) return <div className="m-mobile-document"><NoteDocument key={selected.id} userId={userId} noteId={selected.id} topics={topics}
    onBack={() => onSelect(null)} showBack crumb={selected.title ?? "无标题"}
    /></div>;

  return <div className="m-screen m-notes-screen">
    <header className="m-topbar m-notes-topbar"><button type="button" className="m-ptitle" onClick={onTopicSheet}><span>{title}</span><ChevronDown /></button><span className="grow" /><button type="button" className="m-icon-btn" aria-label="新建笔记" onClick={onCreate}><Plus /></button></header>
    <label className="m-search"><Search aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索当前清单" aria-label="搜索当前清单" /></label>
    <div className="m-list">
      {items.length ? items.map((item) => <MobileItemRow key={item.id} item={item} current={item.id === selectedId} onOpen={() => onSelect(item)} onLongPress={onLongPress} />)
        : <p className="m-empty">{query.trim() ? "没有匹配的内容" : "这个分区还没有笔记。"}</p>}
    </div>
  </div>;
}

export function MobileMe({ userId, username, role, onSettings, onOpenPrivate, onStatus, onLogout, onOpenSection }: {
  userId: string; username: string; role: string; onSettings: (section?: SettingsSection) => void; onOpenPrivate: () => void; onStatus: () => void; onLogout: () => void;
  onOpenSection: (section: NoteSection) => void;
}) {
  useLockVersion();
  const { items: allItems, topics } = useHomeSnapshot(userId);
  const hidden = hiddenPrivateTopicIds(topics);
  const items = allItems.filter((item) => !item.topicId || !hidden.has(item.topicId));
  const space = topics.find((topic) => topic.depth === 0 && topic.isEncSpace && topic.deletedAt === null);
  const spaceLabel = space && isTopicUnlocked(space.id) ? "已解锁" : space ? "锁定" : "未设置";
  const pending = usePendingOutboxCount();
  const notes = items.filter((item) => item.type !== "memo");
  const memos = items.filter((item) => item.type === "memo");
  const attachments = new Set(items.flatMap((item) => item.attachmentHashes)).size;
  const weekStart = Date.now() - 7 * 86_400_000;
  const week = items.filter((item) => item.createdAt >= weekStart).length;
  const tags = [...new Set(items.flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b));

  return <div className="m-screen m-me">
    <header className="m-topbar"><strong className="m-page-title">我的</strong><span className="grow" /><button type="button" className="m-icon-btn" onClick={() => onSettings("appearance")} aria-label="设置"><Settings /></button></header>
    <div className="m-me-scroll">
      <div className="m-mecard"><span className="av">{username.slice(0, 1).toUpperCase()}</span><span className="nm"><b>{username}</b><em><i />{role === "owner" ? "管理员" : "成员"}</em></span><ChevronRight /></div>
      <div className="m-mstat"><span>待同步 {pending}</span><i /><SyncBadge /><i /><span>本机优先</span></div>
      <section className="m-ov"><div className="m-ov-h"><b>数据概览</b></div><div className="m-ov-grid">
        <div><b>{notes.length}</b><em>笔记</em></div><div><b>{memos.length}</b><em>Memo</em></div><div><b>{attachments}</b><em>附件</em></div><div><b>{week}<span>条</span></b><em>本周新增</em></div>
      </div></section>
      <div className="m-msec"><b>内容</b></div>
      <button type="button" className="m-mi" onClick={onOpenPrivate}><LockKeyhole />私人空间<em>{spaceLabel}</em><ChevronRight className="chev" /></button>
      <button type="button" className="m-mi" onClick={() => tags[0] && onOpenSection({ kind: "tag", tag: tags[0] })}><Tag />标签<em>{tags.length}</em><ChevronRight className="chev" /></button>
      <div className="m-msec"><b>设置</b></div>
      <button type="button" className="m-mi" onClick={() => onSettings("appearance")}><Settings />外观与账户<ChevronRight className="chev" /></button>
      <button type="button" className="m-mi" onClick={() => onSettings("backup")}><Archive />同步与备份<ChevronRight className="chev" /></button>
      <button type="button" className="m-mi" onClick={() => onSettings("recovery")}><LockKeyhole />加密与恢复<ChevronRight className="chev" /></button>
      <button type="button" className="m-mi" onClick={onStatus}><Clock3 />资源状态<em>查看</em><ChevronRight className="chev" /></button>
      <button type="button" className="m-mi" onClick={onLogout}><UserRound />退出登录<ChevronRight className="chev" /></button>
      <footer className="m-version">Menote · 本地优先笔记</footer>
    </div>
  </div>;
}

export function MobileTopicSheet({ userId, selected, onClose, onOpenPrivate, onSelect }: {
  userId: string; selected: NoteSection; onClose: () => void; onOpenPrivate: () => void; onSelect: (section: NoteSection) => void;
}) {
  useLockVersion();
  const topics = useTopics(userId).filter((topic) => topic.deletedAt === null);
  const space = topics.find((topic) => topic.depth === 0 && topic.isEncSpace);
  const roots = topics.filter((topic) => topic.depth === 0 && !topic.isEncSpace).sort((a, b) => a.name.localeCompare(b.name));
  const allTags = [...new Set(useHomeSnapshot(userId).items.filter((item) => item.type === "memo" || !item.topicId || !alwaysHiddenPrivateTopicIds(topics).has(item.topicId)).flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b));

  return <div className="m-sheet-overlay" role="presentation" onClick={onClose}><section className="m-topic-sheet" role="dialog" aria-modal="true" aria-label="主题导航" onClick={(event) => event.stopPropagation()}>
    <header className="m-sheet-head"><button type="button" className="m-icon-btn" aria-label="关闭" onClick={onClose}><ArrowLeft /></button><b>主题与标签</b><span className="grow" /><button type="button" className="m-icon-btn" aria-label="关闭" onClick={onClose}><X /></button></header>
    <div className="m-sheet-scroll">
      <button type="button" className={`m-tree-row${selected.kind === "recent" ? " on" : ""}`} onClick={() => { onSelect({ kind: "recent" }); onClose(); }}><Clock3 />最近编辑</button>
      {roots.map((topic) => {
        const groups = topics.filter((row) => row.depth === 1 && row.parentId === topic.id).sort((a, b) => a.name.localeCompare(b.name));
        const current = selected.kind === "topic" && (selected.id === topic.id || groups.some((group) => group.id === selected.id));
        return <div key={topic.id}>
          <button type="button" className={`m-tree-row${current ? " on" : ""}`} aria-current={selected.kind === "topic" && selected.id === topic.id} onClick={() => { onSelect({ kind: "topic", id: topic.id }); onClose(); }}><Folder />{topic.name}<ChevronRight /></button>
          {groups.map((group) => <button type="button" className={`m-tree-row sub${selected.kind === "topic" && selected.id === group.id ? " on" : ""}`} key={group.id} onClick={() => { onSelect({ kind: "topic", id: group.id }); onClose(); }}>{group.name}</button>)}
        </div>;
      })}
      <div className="m-lsec"><b>加密空间</b></div>
      <button type="button" className="m-tree-row" onClick={() => {
        if (space && isTopicUnlocked(space.id)) { onSelect({ kind: "topic", id: space.id }); onClose(); return; }
        onOpenPrivate();
        onClose();
      }}><LockKeyhole />私人空间<em>{space && isTopicUnlocked(space.id) ? "已解锁" : space ? "锁定" : "未设置"}</em></button>
      <div className="m-lsec"><b>标签</b></div><div className="m-tagrow">{allTags.length ? allTags.map((tag) => <button type="button" key={tag} className={selected.kind === "tag" && selected.tag === tag ? "on" : ""} onClick={() => { onSelect({ kind: "tag", tag }); onClose(); }}>#{tag}</button>) : <span>暂无标签</span>}</div>
    </div>
  </section></div>;
}

function MobileItemRow({ item, current = false, onOpen, onLongPress }: {
  item: Item; current?: boolean; onOpen: () => void; onLongPress?: (item: Item) => void;
}) {
  const timer = useRef<number | undefined>(undefined);
  const held = useRef(false);
  const stop = () => window.clearTimeout(timer.current);
  return <button type="button" className={`m-nrow${current ? " on" : ""}`} onPointerDown={() => {
    held.current = false;
    if (onLongPress) timer.current = window.setTimeout(() => { held.current = true; onLongPress(item); }, 480);
  }} onPointerUp={stop} onPointerLeave={stop} onContextMenu={(event) => { event.preventDefault(); onLongPress?.(item); }} onClick={() => {
    if (held.current) { held.current = false; return; }
    onOpen();
  }}>
    <span className="ic">{item.type === "memo" ? <Clock3 /> : <FileText />}</span><span className="copy"><b>{item.title || previewText(item) || "（空白）"}{item.content.scope !== "plain" && <LockKeyhole className="lock" />}</b><em>{previewText(item)}</em></span><time className="d">{dateLabel(item.updatedAt)}</time>
  </button>;
}
