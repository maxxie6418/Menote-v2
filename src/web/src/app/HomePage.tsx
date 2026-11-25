import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { ArrowUpRight, Download, FilePlus2, Paperclip, Search, Table2, Tag } from "../icons";
import type { Item } from "@menote/shared";
import type { BrowseSection } from "../services/contentHooks";
import { useHomeSnapshot, useLocalSearch, useRecentItems } from "../services/contentHooks";
import { alwaysHiddenPrivateTopicIds } from "../services/privateSpaceService";
import { useMemoCapture } from "../features/memo";

interface HomePageProps {
  userId: string; username: string; onCreateNote: () => void; onCreateTable: () => void; onImportMarkdown: (files: File[]) => Promise<number>;
  onOpenItem: (item: Item) => void; onNavigate: (section: BrowseSection) => void;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (date.toDateString() === new Date().toDateString()) return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function HomeDocumentRow({ item, timestamp, onOpenItem }: {
  item: Item; timestamp: number; onOpenItem: (item: Item) => void;
}) {
  return <button type="button" className="mn-home-document" onClick={() => onOpenItem(item)}>
    <span className="mn-home-document-icon">{item.type === "table" ? <Table2 /> : <FilePlus2 />}</span>
    <span className="mn-home-document-title">{item.title || "无标题"}</span>
    <time>{formatTime(timestamp)}</time>
  </button>;
}

function HomeStamp({ now }: { now: Date }) {
  return <div className="mn-home-stamp"><time>{now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })}</time><span>{now.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "long" })}</span></div>;
}

function HomeMemoCapture({ input }: { input: RefObject<HTMLTextAreaElement | null> }) {
  const capture = useMemoCapture("home");
  const [memoTagsOpen, setMemoTagsOpen] = useState(false);
  const attachments = useRef<HTMLInputElement>(null);
  const canSubmit = Boolean(capture.body.trim()) && !capture.pending;

  async function submit() {
    if (!canSubmit) return;
    input.current?.focus({ preventScroll: true });
    if (await capture.save()) setMemoTagsOpen(false);
  }

  return (
    <form className="mn-home-capture" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <textarea ref={input} aria-label="快速记录 Memo" placeholder="随手写…" value={capture.body}
        onChange={(event) => capture.setBody(event.target.value)} {...capture.compositionProps}
        onKeyDown={(event) => capture.onShortcut(event, () => void submit())}
        onPaste={(event) => capture.onPaste(event, () => input.current)} />
      <div className="mn-home-capture-tools">
        <button type="button" className="mn-home-capture-tool" aria-expanded={memoTagsOpen}
          onClick={() => setMemoTagsOpen((open) => !open)}><Tag />标签</button>
        {memoTagsOpen && <input className="mn-home-tag-input" autoFocus value={capture.tags}
          onChange={(event) => capture.setTags(event.target.value)} {...capture.compositionProps}
          onKeyDown={(event) => capture.onShortcut(event, () => void submit())}
          aria-label="Memo 标签" placeholder="输入标签，用空格或逗号分隔" />}
        <button type="button" className="mn-home-capture-tool" disabled={Boolean(capture.pending)}
          onClick={() => attachments.current?.click()}>
          <Paperclip />{capture.pending === "upload" ? "上传中…" : "附件"}
        </button>
        <input ref={attachments} type="file" accept="image/*" multiple hidden onChange={(event) => {
          void capture.attachFiles([...(event.currentTarget.files ?? [])], () => input.current);
          event.currentTarget.value = "";
        }} />
        {capture.feedback && <span className="mn-home-capture-feedback" role={capture.feedback.role}>{capture.feedback.text}</span>}
        <button type="submit" disabled={!canSubmit}>{capture.pending === "save" ? "保存中…" : "保存"}</button>
      </div>
    </form>
  );
}

export function HomePage({ userId, username, onCreateNote, onCreateTable, onImportMarkdown, onOpenItem, onNavigate }: HomePageProps) {
  const [query, setQuery] = useState("");
  const [importFeedback, setImportFeedback] = useState("");
  const [clock, setClock] = useState(() => new Date());
  const searchRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const memoInputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const layout = document.querySelector<HTMLElement>(".mn-shell")?.dataset.layout;
    if (layout === "full" || layout === "compact") memoInputRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => { const timer = window.setInterval(() => setClock(new Date()), 30_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !(event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable=true]"))) {
        event.preventDefault(); searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  const hits = useLocalSearch(userId, query);
  const searching = query.trim().length > 0;
  const { items, topics, inboxCount, recentInboxItems } = useHomeSnapshot(userId);
  const recent = useRecentItems(userId);
  // 私人空间无论锁定与否都不进首页最近列表与搜索结果（与 Memo 侧栏、移动端同一口径）。
  const privateIds = alwaysHiddenPrivateTopicIds(topics);
  const visible = (item: Item) => item.topicId === null || !privateIds.has(item.topicId);
  const documents = items.filter((item) => item.type !== "memo" && visible(item));
  const memos = items.filter((item) => item.type === "memo" && visible(item));
  const today = new Date(clock); today.setHours(0, 0, 0, 0);
  const todayMemos = memos.filter((item) => item.createdAt >= today.getTime());
  const recentDocuments = recent.filter((item) => item.type !== "memo" && visible(item)).slice(0, 4);
  const week = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(today); day.setDate(today.getDate() - 6 + index);
    const next = new Date(day); next.setDate(day.getDate() + 1);
    const count = memos.filter((item) => item.createdAt >= day.getTime() && item.createdAt < next.getTime()).length;
    return { day, count };
  });
  const maxCount = Math.max(1, ...week.map((day) => day.count));
  const continueItem = recentDocuments[0];
  const hour = clock.getHours();
  const greeting = hour < 6 ? "夜深了" : hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const count = await onImportMarkdown(Array.from(files));
      setImportFeedback(`已导入 ${count} 篇 Markdown 笔记`);
    } catch {
      setImportFeedback("导入失败，请重试");
    }
  };

  return <main className="mn-home" aria-label="首页">
    <header className="mn-home-bar">
      <label className="mn-home-search"><Search aria-hidden="true" /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索笔记、Memo、标签…" aria-label="搜索笔记、Memo、标签" /></label>
    </header>
    <div className="mn-home-scroll"><div className="mn-home-layout">
      <section className="mn-home-main">
        {!searching && <>
          <HomeStamp now={clock} />
          <h1 className="mn-home-greeting">{greeting}，<b>{username}</b>。想记点什么？</h1>
          <HomeMemoCapture input={memoInputRef} />
          <nav className="mn-home-actions" aria-label="快捷入口">
            <button type="button" onClick={() => continueItem && onOpenItem(continueItem)} disabled={!continueItem}><span className="mn-home-action-icon"><FilePlus2 /></span><span><strong>继续写作</strong><small>{continueItem?.title || "还没有最近编辑的文档"}</small></span></button>
            <button type="button" onClick={() => onNavigate({ kind: "inbox" })}><span className="mn-home-action-icon"><ArrowUpRight /></span><span><strong>收件箱</strong><small>{inboxCount} 条待整理</small></span></button>
            <button type="button" onClick={() => searchRef.current?.focus()}><span className="mn-home-action-icon"><Search /></span><span><strong>搜索</strong><small>笔记与随记</small></span></button>
          </nav>
          <section className="mn-home-recent" aria-label="收件箱">
            <div className="mn-home-recent-heading">
              <span>收件箱</span>
              <button type="button" aria-label={`查看全部收件箱条目，${inboxCount} 条`} onClick={() => onNavigate({ kind: "inbox" })}>全部 {inboxCount} 条</button>
            </div>
            {recentInboxItems.length ? recentInboxItems.map((item) => (
              <HomeDocumentRow key={item.id} item={item} timestamp={item.createdAt} onOpenItem={onOpenItem} />
            )) : <p className="mn-home-empty">收件箱为空</p>}
          </section>
          <section className="mn-home-recent" aria-label="最近文档"><div className="mn-home-recent-heading"><span>最近文档</span><button type="button" onClick={() => onNavigate({ kind: "recent" })}>全部 {documents.length} 篇</button></div>
            {recentDocuments.length ? recentDocuments.map((item) => (
              <HomeDocumentRow key={item.id} item={item} timestamp={item.updatedAt} onOpenItem={onOpenItem} />
            )) : <p className="mn-home-empty">还没有最近编辑的文档</p>}
          </section>
        </>}
        {searching && <section className="mn-home-search-results"><div className="mn-home-recent-heading"><span>搜索结果</span><button type="button" onClick={() => setQuery("")}>清除</button></div>{hits === undefined ? <p className="mn-home-empty">正在查找…</p> : hits.length ? hits.filter((hit) => visible(hit.item)).map((hit) => <button type="button" className="mn-home-document" key={hit.item.id} onClick={() => onOpenItem(hit.item)}><span className="mn-home-document-icon">{hit.item.type === "table" ? <Table2 /> : <FilePlus2 />}</span><span className="mn-home-document-title">{hit.title}</span><time>{hit.item.type === "memo" ? "Memo" : hit.item.type === "table" ? "表格" : "笔记"}</time></button>) : <p className="mn-home-empty">没有匹配的内容</p>}</section>}
      </section>
      {!searching && <aside className="mn-home-side">
        <section className="mn-home-side-block"><div className="mn-home-side-heading"><span>今日</span><time>{clock.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}</time></div>
          <div className="mn-home-side-stat"><span>随手记</span><b>{todayMemos.length}<small>条</small></b></div><div className="mn-home-side-stat"><span>写了</span><b>{todayMemos.reduce((sum, item) => sum + (item.content.scope === "plain" ? item.content.markdown.length : 0), 0)}<small>字</small></b></div><div className="mn-home-side-stat"><span>文档</span><b>{documents.filter((item) => item.updatedAt >= today.getTime()).length}<small>篇</small></b></div><div className="mn-home-side-stat"><span>待整理</span><b className="is-accent">{inboxCount}<small>条</small></b></div>
        </section>
        <section className="mn-home-side-block"><div className="mn-home-side-heading"><span>近 7 天</span><span>{week.reduce((sum, day) => sum + day.count, 0)} 条</span></div><div className="mn-home-bars" role="img" aria-label="最近七天 Memo 数量">{week.map(({ day, count }, index) => <i key={day.toISOString()} data-level={count ? Math.max(1, Math.ceil(count / maxCount * 4)) : 0} className={index === 6 ? "is-today" : ""} title={`${day.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}：${count} 条`} />)}</div><div className="mn-home-bars-legend"><span>{week[0]?.day.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</span><span>今天</span></div></section>
        <section className="mn-home-side-block"><div className="mn-home-side-heading"><span>快捷</span></div><button className="mn-home-side-action" type="button" onClick={onCreateNote}><FilePlus2 />新建笔记</button><button className="mn-home-side-action" type="button" onClick={onCreateTable}><Table2 />新建表格</button><button className="mn-home-side-action" type="button" onClick={() => importRef.current?.click()}><Download />导入 Markdown</button><button className="mn-home-side-action" type="button" onClick={() => searchRef.current?.focus()}><Search />全局搜索</button>{importFeedback && <p className="mn-home-import-feedback" role="status">{importFeedback}</p>}<input ref={importRef} type="file" accept=".md,text/markdown" multiple hidden onChange={(event) => { void importFiles(event.target.files); event.currentTarget.value = ""; }} /></section>
      </aside>}
    </div></div>
    {!searching && <footer className="mn-home-foot"><span className="mn-home-foot-right"><span>随记 {memos.length}</span><span>·</span><span>文档 {documents.length}</span><span>·</span><span>表格 {documents.filter((item) => item.type === "table").length}</span></span></footer>}
  </main>;
}
