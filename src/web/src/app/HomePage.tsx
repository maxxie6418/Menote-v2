import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowUpRight, Clock3, Download, FilePlus2, FileText, Inbox, Paperclip, Search, Table2, Tag } from "../icons";
import type { Item } from "@menote/shared";
import { useHomeSnapshot, useLocalSearch, useRecentItems, type BrowseSection } from "../services/contentHooks";
import { alwaysHiddenPrivateTopicIds } from "../services/privateSpaceService";
import { useMemoCapture } from "../features/memo";

interface HomePageProps {
  userId: string;
  username: string;
  onCreateNote: () => void;
  onCreateTable: () => void;
  onImportMarkdown: (files: File[]) => Promise<number>;
  onOpenItem: (item: Item) => void;
  onNavigate: (section: BrowseSection) => void;
}

const shortTime = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
const shortDate = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" });
const fullDate = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "numeric", day: "numeric", weekday: "long" });

function HomeDocumentRow({ item, timestamp, title = item.title || "无标题", onOpenItem }: {
  item: Item;
  timestamp?: number;
  title?: string;
  onOpenItem: HomePageProps["onOpenItem"];
}) {
  const Icon = item.type === "table" ? Table2 : item.type === "memo" ? Clock3 : FileText;
  const date = timestamp === undefined ? null : new Date(timestamp);
  return <button type="button" className="mn-home-document" onClick={() => onOpenItem(item)}>
    <span className="mn-home-document-icon"><Icon aria-hidden="true" /></span>
    <span className="mn-home-document-title" title={title}>{title}</span>
    {date && Number.isFinite(date.getTime())
      ? <time className="mn-home-document-meta" dateTime={date.toISOString()}>
          {date.toDateString() === new Date().toDateString() ? shortTime.format(date) : shortDate.format(date)}
        </time>
      : <span className="mn-home-document-meta">{item.type === "memo" ? "Memo" : item.type === "table" ? "表格" : "笔记"}</span>}
  </button>;
}

function HomeCollection({ kind, items, count, onNavigate, onOpenItem }: {
  kind: "inbox" | "recent";
  items: Item[];
  count: number;
  onNavigate: HomePageProps["onNavigate"];
  onOpenItem: HomePageProps["onOpenItem"];
}) {
  const inbox = kind === "inbox";
  const title = inbox ? "收件箱" : "最近文档";
  const Icon = inbox ? Inbox : Clock3;
  const countLabel = inbox ? `${count} 条` : `${count} 篇`;
  return <section className="mn-home-collection" aria-label={title}>
    <header className="mn-home-collection-head">
      <h2><Icon aria-hidden="true" />{title}</h2>
      <button className="mn-home-link" type="button" aria-label={`查看全部${title}，${countLabel}`} onClick={() => onNavigate({ kind })}>
        全部 {countLabel}<ArrowUpRight aria-hidden="true" />
      </button>
    </header>
    {items.length ? <div className="mn-home-document-list">
      {items.map((item) => <HomeDocumentRow key={item.id} item={item}
        timestamp={inbox ? item.createdAt : item.updatedAt} onOpenItem={onOpenItem} />)}
    </div> : <p className="mn-home-empty">{inbox ? "收件箱为空" : "还没有最近编辑的文档"}</p>}
  </section>;
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
      {memoTagsOpen && <div className="mn-home-tag-edit">
        <input className="mn-home-tag-input" autoFocus value={capture.tags}
          onChange={(event) => capture.setTags(event.target.value)} {...capture.compositionProps}
          onKeyDown={(event) => capture.onShortcut(event, () => void submit())}
          aria-label="Memo 标签" placeholder="输入标签，用空格或逗号分隔" />
      </div>}
      <div className="mn-home-capture-tools">
        <button type="button" className="mn-home-capture-tool" aria-expanded={memoTagsOpen}
          onClick={() => setMemoTagsOpen((open) => !open)}><Tag aria-hidden="true" />标签</button>
        <button type="button" className="mn-home-capture-tool" disabled={Boolean(capture.pending)}
          onClick={() => attachments.current?.click()}>
          <Paperclip aria-hidden="true" />{capture.pending === "upload" ? "上传中…" : "附件"}
        </button>
        <input ref={attachments} type="file" accept="image/*" multiple hidden onChange={(event) => {
          void capture.attachFiles([...(event.currentTarget.files ?? [])], () => input.current);
          event.currentTarget.value = "";
        }} />
        <button type="submit" className="mn-home-save" disabled={!canSubmit}>{capture.pending === "save" ? "保存中…" : "保存 Memo"}</button>
      </div>
      {capture.feedback && <p className="mn-home-feedback" role={capture.feedback.role}>{capture.feedback.text}</p>}
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
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "k") return;
      if (document.querySelector('[aria-modal="true"]:not([hidden])')) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hits = useLocalSearch(userId, query);
  const searching = query.trim().length > 0;
  const { items, topics, inboxCount, recentInboxItems } = useHomeSnapshot(userId);
  const recent = useRecentItems(userId);
  // 私人空间不进入首页统计、最近文档与搜索。
  const privateIds = alwaysHiddenPrivateTopicIds(topics);
  const visible = (item: Item) => item.topicId === null || !privateIds.has(item.topicId);
  const documents = items.filter((item) => item.type !== "memo" && visible(item));
  const recentDocuments = recent.filter((item) => item.type !== "memo" && visible(item)).slice(0, 4);
  const visibleHits = hits?.filter((hit) => visible(hit.item));
  const today = new Date(clock).setHours(0, 0, 0, 0);
  const todayMemos = items.filter((item) => item.type === "memo" && item.createdAt >= today && visible(item));
  const todayWords = todayMemos.reduce((sum, item) => sum + (item.content.scope === "plain" ? item.content.markdown.length : 0), 0);
  const todayDocuments = documents.filter((item) => item.updatedAt >= today).length;
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
    <div className="mn-home-layout">
      <header className="mn-home-header">
        <div className="mn-home-heading">
          <div className="mn-home-stamp"><span>{fullDate.format(clock)}</span><time dateTime={clock.toISOString()}>{shortTime.format(clock)}</time></div>
          <h1 className="mn-home-greeting">{greeting}，{username}</h1>
        </div>
        <label className="mn-home-search">
          <Search aria-hidden="true" />
          <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索笔记、Memo、标签…" aria-label="搜索笔记、Memo、标签" />
        </label>
      </header>
      {searching ? <section className="mn-home-collection" aria-label="搜索结果">
        <header className="mn-home-collection-head">
          <h2><Search aria-hidden="true" />搜索结果</h2>
          <button className="mn-home-link" type="button" onClick={() => { setQuery(""); searchRef.current?.focus(); }}>清除搜索</button>
        </header>
        {visibleHits === undefined ? <p className="mn-home-empty" role="status">正在查找…</p>
          : visibleHits.length ? <div className="mn-home-document-list">
            {visibleHits.map((hit) => <HomeDocumentRow key={hit.item.id} item={hit.item} title={hit.title} onOpenItem={onOpenItem} />)}
          </div> : <p className="mn-home-empty">没有匹配的内容</p>}
      </section> : <>
        <section className="mn-home-capture-section" aria-labelledby="mn-home-capture-heading">
          <div className="mn-home-capture-head">
            <h2 id="mn-home-capture-heading">随手记</h2>
            <div className="mn-home-create-actions" role="group" aria-label="新建与导入">
              <button type="button" onClick={onCreateNote}><FilePlus2 aria-hidden="true" />新建笔记</button>
              <button type="button" onClick={onCreateTable}><Table2 aria-hidden="true" />新建表格</button>
              <button type="button" onClick={() => importRef.current?.click()}><Download aria-hidden="true" />导入 Markdown</button>
              <input ref={importRef} type="file" accept=".md,text/markdown" multiple hidden onChange={(event) => {
                void importFiles(event.target.files);
                event.currentTarget.value = "";
              }} />
            </div>
          </div>
          {importFeedback && <p className="mn-home-feedback" role="status">{importFeedback}</p>}
          <HomeMemoCapture input={memoInputRef} />
        </section>
        <div className="mn-home-collections">
          <HomeCollection kind="inbox" items={recentInboxItems} count={inboxCount} onNavigate={onNavigate} onOpenItem={onOpenItem} />
          <HomeCollection kind="recent" items={recentDocuments} count={documents.length} onNavigate={onNavigate} onOpenItem={onOpenItem} />
        </div>
        <footer className="mn-home-activity" aria-label="今日概况">
          <strong>今日</strong>
          <span>Memo {todayMemos.length} 条 · {todayWords} 字</span>
          <span>文档更新 {todayDocuments} 篇</span>
        </footer>
      </>}
    </div>
  </main>;
}
