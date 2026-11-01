import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, Home, ListTodo, Plus, UserRound, X } from "lucide-react";
import type { AuthUser, Item } from "@menote/shared";
import { createNote, saveItemMeta, softDeleteItem } from "../services/contentService";
import { restoreFromTrash } from "../services/versionService";
import { MobileComposer, type ComposeMode } from "./MobileComposer";
import { MobileHome, MobileMe, MobileMemo, MobileNotes, MobileTopicSheet, type MobilePage, type NoteSection } from "./MobileScreens";

interface MobileAppProps {
  user: AuthUser;
  onLogout: () => void;
  onOpenSettings: () => void;
  onOpenStatus: () => void;
}

export function MobileApp({ user, onLogout, onOpenSettings, onOpenStatus }: MobileAppProps) {
  const appRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<MobilePage>("home");
  const [noteSection, setNoteSection] = useState<NoteSection>({ kind: "recent" });
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [topicSheetOpen, setTopicSheetOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<ComposeMode>("memo");
  const [composeBody, setComposeBody] = useState("");
  const [composeTitle, setComposeTitle] = useState("");
  const [composeTags, setComposeTags] = useState("");
  const [actionItem, setActionItem] = useState<Item | null>(null);
  const [actionTags, setActionTags] = useState("");
  const [undoItem, setUndoItem] = useState<Item | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);
  const userId = user.id;

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const syncKeyboardInset = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      appRef.current?.style.setProperty("--kb", `${inset}px`);
    };
    syncKeyboardInset();
    viewport.addEventListener("resize", syncKeyboardInset);
    viewport.addEventListener("scroll", syncKeyboardInset);
    return () => {
      viewport.removeEventListener("resize", syncKeyboardInset);
      viewport.removeEventListener("scroll", syncKeyboardInset);
    };
  }, []);

  const openSection = (section: NoteSection) => {
    setPage("notes");
    setNoteSection(section);
    setSelectedNoteId(null);
  };

  const createAndOpenNote = async () => {
    const created = await createNote(userId);
    setNoteSection({ kind: "drafts" });
    setSelectedNoteId(created.id);
    setPage("notes");
  };

  const openMemo = (id: string) => {
    setPage("memo");
    window.setTimeout(() => document.getElementById(`memo-${id}`)?.scrollIntoView({ block: "center" }), 0);
  };

  const onLongPress = (item: Item) => {
    setActionItem(item);
    setActionTags(item.tags.join(" "));
  };

  const closeAction = () => setActionItem(null);

  const deleteItem = async () => {
    if (!actionItem) return;
    const item = actionItem;
    await softDeleteItem(userId, item.id);
    setActionItem(null);
    setUndoItem(item);
    window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndoItem(null), 8_000);
  };

  const saveTags = async () => {
    if (!actionItem) return;
    const tags = [...new Set(actionTags.split(/[，,\s]+/).map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean))];
    await saveItemMeta(userId, actionItem.id, { tags });
    setActionItem(null);
  };

  const switchComposeMode = (next: ComposeMode) => {
    if (next === composeMode) return;
    if (composeMode === "note" && next === "memo" && composeTitle.trim()) {
      setComposeBody((body) => `${composeTitle.trim()}${body.trim() ? `\n\n${body}` : ""}`);
      setComposeTitle("");
    }
    if (composeMode === "memo" && next === "note") setComposeTitle("");
    setComposeMode(next);
  };

  const handleSaved = (item: Item) => {
    setComposeOpen(false);
    setComposeBody("");
    setComposeTitle("");
    setComposeTags("");
    if (item.type !== "memo") {
      setPage("notes");
      setNoteSection({ kind: "drafts" });
      setSelectedNoteId(item.id);
    }
  };

  return <div ref={appRef} className="m-app" data-page={page}>
    <div className="m-body">
      {page === "home" && <MobileHome userId={userId} onOpenItem={(item) => {
        if (item.type === "memo") openMemo(item.id);
        else { setPage("notes"); setNoteSection({ kind: "recent" }); setSelectedNoteId(item.id); }
      }} onOpenSection={openSection} />}
      {page === "memo" && <MobileMemo userId={userId} onLongPress={onLongPress} onOpenMemo={openMemo} />}
      {page === "notes" && <MobileNotes userId={userId} section={noteSection} selectedId={selectedNoteId} onSelect={(item) => setSelectedNoteId(item?.id ?? null)}
        onTopicSheet={() => setTopicSheetOpen(true)} onCreate={() => void createAndOpenNote()} onLongPress={onLongPress} />}
      {page === "me" && <MobileMe userId={userId} username={user.username} role={user.role} onSettings={onOpenSettings} onStatus={onOpenStatus} onLogout={onLogout} onOpenSection={openSection} />}
    </div>
    <MobileTabBar page={page} onPage={(next) => { setPage(next); if (next === "notes") setSelectedNoteId(null); }} onRecord={() => setComposeOpen(true)} />

    {topicSheetOpen && <MobileTopicSheet userId={userId} selected={noteSection} onClose={() => setTopicSheetOpen(false)} onSelect={setNoteSection} />}
    {composeOpen && <MobileComposer userId={userId} mode={composeMode} body={composeBody} title={composeTitle} tags={composeTags}
      onMode={switchComposeMode} onBody={setComposeBody} onTitle={setComposeTitle} onTags={setComposeTags}
      onClose={() => setComposeOpen(false)} onSaved={handleSaved} />}
    {actionItem && <div className="m-sheet-overlay" role="presentation" onClick={closeAction}><section className="m-action-sheet" role="dialog" aria-modal="true" aria-label="条目操作" onClick={(event) => event.stopPropagation()}>
      <div className="m-action-grab"><i /></div><h2>{actionItem.title || (actionItem.content.scope === "plain" ? actionItem.content.markdown.slice(0, 36) : "已加密")}</h2>
      {actionItem.type === "memo" && <div className="m-status-choice" role="group" aria-label="任务状态">
        {([ ["todo", "待办"], ["doing", "进行中"], ["done", "已完成"] ] as const).map(([status, label]) => <button type="button" className={actionItem.status === status ? "on" : ""} key={status} onClick={() => { void saveItemMeta(userId, actionItem.id, { status }); setActionItem(null); }}>{actionItem.status === status && <Check />}{label}</button>)}
      </div>}
      <label className="m-action-tags"><span>标签</span><input value={actionTags} onChange={(event) => setActionTags(event.target.value)} placeholder="用空格或逗号分隔" /></label>
      <div className="m-action-buttons"><button type="button" onClick={() => void saveTags()}>保存标签</button><button type="button" className="danger" onClick={() => void deleteItem()}>移入回收站</button><button type="button" className="cancel" onClick={closeAction}>取消</button></div>
    </section></div>}
    {undoItem && <div className="m-undo" role="status"><span>已移入回收站</span><button type="button" onClick={() => { void restoreFromTrash(userId, undoItem.id); setUndoItem(null); window.clearTimeout(undoTimer.current); }}>撤销</button><button type="button" aria-label="关闭撤销提示" onClick={() => setUndoItem(null)}><X /></button></div>}
  </div>;
}

function MobileTabBar({ page, onPage, onRecord }: { page: MobilePage; onPage: (page: MobilePage) => void; onRecord: () => void }) {
  const pointerStart = useRef<[number, number] | null>(null);
  const record = (event: React.PointerEvent<HTMLButtonElement>) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
      && Math.abs(event.clientX - start[0]) <= 44 && Math.abs(event.clientY - start[1]) <= 44;
    if (inside) onRecord();
  };
  return <nav className="m-tabbar" aria-label="主导航">
    <button type="button" className="m-tab" aria-current={page === "home" ? "page" : undefined} onClick={() => onPage("home")}><Home /><b>首页</b></button>
    <button type="button" className="m-tab" aria-current={page === "memo" ? "page" : undefined} onClick={() => onPage("memo")}><ListTodo /><b>Memo</b></button>
    <span className="m-tab m-tab--record"><button type="button" className="m-record" aria-label="记录" onPointerDown={(event) => {
      pointerStart.current = [event.clientX, event.clientY];
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerUp={record} onPointerCancel={() => { pointerStart.current = null; }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onRecord(); } }}><Plus /></button></span>
    <button type="button" className="m-tab" aria-current={page === "notes" ? "page" : undefined} onClick={() => onPage("notes")}><BookOpen /><b>笔记</b></button>
    <button type="button" className="m-tab" aria-current={page === "me" ? "page" : undefined} onClick={() => onPage("me")}><UserRound /><b>我的</b></button>
  </nav>;
}
