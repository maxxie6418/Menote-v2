import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Download, FilePlus2, LockKeyhole, Paperclip, Search, Table2, Tag } from "lucide-react";
import type { Item } from "@menote/shared";
import type { BrowseSection } from "../services/contentHooks";
import { useHomeSnapshot, useLocalSearch, useRecentItems } from "../services/contentHooks";
import { createMemo } from "../services/contentService";
import { uploadAttachment } from "../services/attachmentService";
import { alwaysHiddenPrivateTopicIds } from "../services/privateSpaceService";
import { insertAttachment } from "../features/editor";

interface HomePageProps {
  userId: string; username: string; onCreateNote: () => void; onCreateTable: () => void; onImportMarkdown: (files: File[]) => Promise<number>;
  onOpenItem: (item: Item) => void; onNavigate: (section: BrowseSection) => void;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (date.toDateString() === new Date().toDateString()) return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

/** 顶部时间牌自带秒级步进：秒针只重渲染这块，不拖动整页（问候/统计走父级分钟级时钟）。 */
function HomeStamp() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  return <div className="mn-home-stamp"><time>{now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</time><span>{now.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "long" })}</span></div>;
}

export function HomePage({ userId, username, onCreateNote, onCreateTable, onImportMarkdown, onOpenItem, onNavigate }: HomePageProps) {
  const [query, setQuery] = useState("");
  const [memoDraft, setMemoDraft] = useState("");
  const [memoSaved, setMemoSaved] = useState(false);
  const [memoSaveError, setMemoSaveError] = useState(false);
  const [memoUploadError, setMemoUploadError] = useState(false);
  const [memoUploading, setMemoUploading] = useState(false);
  const [memoTagInput, setMemoTagInput] = useState("");
  const [memoTagsOpen, setMemoTagsOpen] = useState(false);
  const [importFeedback, setImportFeedback] = useState("");
  const [historyOpen, setHistoryOpen] = useState(true);
  const [clock, setClock] = useState(() => new Date());
  const searchRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const memoInputRef = useRef<HTMLTextAreaElement>(null);
  const memoAttachmentRef = useRef<HTMLInputElement>(null);
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
  const snapshot = useHomeSnapshot(userId);
  const recent = useRecentItems(userId);
  // 私人空间无论锁定与否都不进首页最近列表与搜索结果（与 Memo 侧栏、移动端同一口径）。
  const privateIds = alwaysHiddenPrivateTopicIds(snapshot.topics);
  const visible = (item: Item) => item.topicId === null || !privateIds.has(item.topicId);
  const documents = snapshot.items.filter((item) => item.type !== "memo" && visible(item));
  const memos = snapshot.items.filter((item) => item.type === "memo" && visible(item));
  const today = new Date(clock); today.setHours(0, 0, 0, 0);
  const todayMemos = memos.filter((item) => item.createdAt >= today.getTime());
  const recentDocuments = recent.filter((item) => item.type !== "memo" && visible(item)).slice(0, 4);
  const recentMemos = [...memos].sort((a, b) => b.createdAt - a.createdAt).slice(0, 4);
  const week = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(today); day.setDate(today.getDate() - 6 + index);
    const next = new Date(day); next.setDate(day.getDate() + 1);
    const count = memos.filter((item) => item.createdAt >= day.getTime() && item.createdAt < next.getTime()).length;
    return { day, count };
  });
  const maxCount = Math.max(1, ...week.map((day) => day.count));
  const inboxCount = documents.filter((item) => item.topicId === null && item.source !== "manual").length;
  const continueItem = recentDocuments[0];
  const hour = clock.getHours();
  const greeting = hour < 6 ? "夜深了" : hour < 11 ? "早上好" : hour < 14 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
  const saveMemo = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const text = memoDraft.trim(); if (!text) return;
    setMemoSaveError(false);
    const tags = [...new Set(memoTagInput.split(/[，,\s]+/).map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean))];
    void createMemo(userId, text, tags).then(() => { setMemoDraft(""); setMemoTagInput(""); setMemoTagsOpen(false); setMemoSaved(true); memoInputRef.current?.focus({ preventScroll: true }); window.setTimeout(() => setMemoSaved(false), 2600); }).catch(() => setMemoSaveError(true));
  };
  const attachMemoFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const textarea = memoInputRef.current;
    let markdown = memoDraft;
    let caret = textarea?.selectionStart ?? markdown.length;
    setMemoUploading(true); setMemoUploadError(false);
    try {
      for (const file of Array.from(files)) {
        const uploaded = await uploadAttachment(userId, file);
        if ("error" in uploaded) { setMemoUploadError(true); continue; }
        const placed = insertAttachment(markdown, caret, { sha256: uploaded.sha256, name: uploaded.name }, file.type.startsWith("image/"));
        markdown = placed.markdown; caret = placed.selectionStart;
      }
      setMemoDraft(markdown);
      requestAnimationFrame(() => { textarea?.focus(); textarea?.setSelectionRange(caret, caret); });
    } catch { setMemoUploadError(true); }
    finally { setMemoUploading(false); }
  };
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
      <label className="mn-home-search"><Search aria-hidden="true" /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索笔记、Memo" aria-label="搜索笔记、Memo" /><kbd>⌘K</kbd></label>
    </header>
    <div className="mn-home-scroll"><div className="mn-home-layout">
      <section className="mn-home-main">
        {!searching && <>
          <HomeStamp />
          <h1 className="mn-home-greeting">{greeting}，<b>{username.slice(0, 1)}</b>。想记点什么？</h1>
          <form className="mn-home-capture" onSubmit={saveMemo}>
            <textarea ref={memoInputRef} aria-label="快速记录 Memo" placeholder="随手写。这里不会显示任何历史内容。" value={memoDraft} disabled={memoUploading} onChange={(event) => { setMemoDraft(event.target.value); setMemoSaved(false); }} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
            <div className="mn-home-capture-tools"><button type="button" className="mn-home-capture-tool" aria-expanded={memoTagsOpen} onClick={() => setMemoTagsOpen((open) => !open)}><Tag />标签</button>{memoTagsOpen && <input className="mn-home-tag-input" autoFocus value={memoTagInput} onChange={(event) => setMemoTagInput(event.target.value)} aria-label="Memo 标签" placeholder="输入标签，用空格或逗号分隔" />}<button type="button" className="mn-home-capture-tool" disabled={memoUploading} onClick={() => memoAttachmentRef.current?.click()}><Paperclip />{memoUploading ? "上传中…" : "附件"}</button><input ref={memoAttachmentRef} type="file" accept="image/*" multiple hidden onChange={(event) => { void attachMemoFiles(event.target.files); event.currentTarget.value = ""; }} /><span className="mn-home-capture-feedback" role={memoSaveError || memoUploadError ? "alert" : undefined}>{memoSaveError ? "保存失败，请重试" : memoUploadError ? "附件上传失败，请重试" : memoSaved ? "已存入收集箱" : "存为随记 · 不跳转、不回显"}</span><kbd>⌘↵</kbd><button type="submit" disabled={!memoDraft.trim() || memoUploading}>保存</button></div>
          </form>
          <nav className="mn-home-actions" aria-label="快捷入口">
            <button type="button" onClick={() => continueItem && onOpenItem(continueItem)} disabled={!continueItem}><span className="mn-home-action-icon"><FilePlus2 /></span><span><strong>继续写作</strong><small>{continueItem?.title || "还没有最近编辑的文档"}</small></span></button>
            <button type="button" onClick={() => onNavigate({ kind: "inbox" })}><span className="mn-home-action-icon"><ArrowUpRight /></span><span><strong>收件箱</strong><small>{inboxCount} 条待整理</small></span></button>
            <button type="button" onClick={() => searchRef.current?.focus()}><span className="mn-home-action-icon"><Search /></span><span><strong>搜索</strong><small>笔记与随记 · ⌘K</small></span></button>
          </nav>
          <section className="mn-home-recent" aria-label="最近文档"><div className="mn-home-recent-heading"><span>最近文档</span><button type="button" onClick={() => onNavigate({ kind: "recent" })}>全部 {documents.length} 篇</button></div>
            {recentDocuments.length ? recentDocuments.map((item) => <button type="button" className="mn-home-document" key={item.id} onClick={() => onOpenItem(item)}><span className="mn-home-document-icon">{item.type === "table" ? <Table2 /> : <FilePlus2 />}</span><span className="mn-home-document-title">{item.title || "无标题"}</span><time>{formatTime(item.updatedAt)}</time></button>) : <p className="mn-home-empty">还没有最近编辑的文档</p>}
          </section>
          <section className={`mn-home-history${historyOpen ? " is-open" : ""}`}><div><LockKeyhole /><span>最近随记 · <b>{recentMemos.length ? `共 ${memos.length} 条` : "暂无随记"}</b></span><button type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen((open) => !open)}>{historyOpen ? "隐藏" : "显示"}</button></div>
            {historyOpen && <ul>{recentMemos.map((item) => <li key={item.id}><time>{formatTime(item.createdAt)}</time><button type="button" onClick={() => onOpenItem(item)}>{item.content.scope === "plain" ? item.content.markdown || "（空白随记）" : "已加密"}</button></li>)}</ul>}
          </section>
        </>}
        {searching && <section className="mn-home-search-results"><div className="mn-home-recent-heading"><span>搜索结果</span><button type="button" onClick={() => setQuery("")}>清除</button></div>{hits === undefined ? <p className="mn-home-empty">正在查找…</p> : hits.length ? hits.filter((hit) => visible(hit.item)).map((hit) => <button type="button" className="mn-home-document" key={hit.item.id} onClick={() => onOpenItem(hit.item)}><span className="mn-home-document-icon">{hit.item.type === "table" ? <Table2 /> : <FilePlus2 />}</span><span className="mn-home-document-title">{hit.title}</span><time>{hit.item.type === "memo" ? "Memo" : hit.item.type === "table" ? "表格" : "笔记"}</time></button>) : <p className="mn-home-empty">没有匹配的内容</p>}</section>}
      </section>
      {!searching && <aside className="mn-home-side">
        <section className="mn-home-side-block"><div className="mn-home-side-heading"><span>今日</span><time>{clock.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}</time></div>
          <div className="mn-home-side-stat"><span>随手记</span><b>{todayMemos.length}<small>条</small></b></div><div className="mn-home-side-stat"><span>写了</span><b>{todayMemos.reduce((sum, item) => sum + (item.content.scope === "plain" ? item.content.markdown.length : 0), 0)}<small>字</small></b></div><div className="mn-home-side-stat"><span>文档</span><b>{documents.filter((item) => item.updatedAt >= today.getTime()).length}<small>篇</small></b></div><div className="mn-home-side-stat"><span>待整理</span><b className="is-accent">{inboxCount}<small>条</small></b></div>
        </section>
        <section className="mn-home-side-block"><div className="mn-home-side-heading"><span>近 7 天</span><span>{week.reduce((sum, day) => sum + day.count, 0)} 条</span></div><div className="mn-home-bars" role="img" aria-label="最近七天 Memo 数量">{week.map(({ day, count }, index) => <i key={day.toISOString()} data-level={count ? Math.max(1, Math.ceil(count / maxCount * 4)) : 0} className={index === 6 ? "is-today" : ""} title={`${day.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}：${count} 条`} />)}</div><div className="mn-home-bars-legend"><span>{week[0]?.day.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })}</span><span>今天</span></div></section>
        <section className="mn-home-side-block"><div className="mn-home-side-heading"><span>快捷</span></div><button className="mn-home-side-action" type="button" onClick={onCreateNote}><FilePlus2 />新建笔记<kbd>⌘N</kbd></button><button className="mn-home-side-action" type="button" onClick={onCreateTable}><Table2 />新建表格</button><button className="mn-home-side-action" type="button" onClick={() => importRef.current?.click()}><Download />导入 Markdown</button><button className="mn-home-side-action" type="button" onClick={() => searchRef.current?.focus()}><Search />全局搜索<kbd>⌘K</kbd></button>{importFeedback && <p className="mn-home-import-feedback" role="status">{importFeedback}</p>}<input ref={importRef} type="file" accept=".md,text/markdown" multiple hidden onChange={(event) => { void importFiles(event.target.files); event.currentTarget.value = ""; }} /></section>
      </aside>}
    </div></div>
    {!searching && <footer className="mn-home-foot"><span>⌘K 搜索</span><span>·</span><span>⌘N 新建笔记</span><span className="mn-home-foot-right"><span>随记 {memos.length}</span><span>·</span><span>文档 {documents.length}</span><span>·</span><span>表格 {documents.filter((item) => item.type === "table").length}</span></span></footer>}
  </main>;
}
