import { useRef, useState } from "react";
import { Bold, CheckSquare, ChevronDown, ImagePlus, Italic, Paperclip, Tag, Type } from "../icons";
import type { Item } from "@menote/shared";
import { createNote, saveItemContent, saveItemMeta } from "../services/contentService";
import { parseCaptureTags, useMemoCapture } from "../features/memo";

export type ComposeMode = "memo" | "note";

interface MobileComposerProps {
  userId: string;
  mode: ComposeMode;
  title: string;
  onMode: (mode: ComposeMode) => void;
  onTitle: (value: string) => void;
  onClose: () => void;
  onSaved: (item: Item) => void;
}

export function MobileComposer({ userId, mode, title, onMode, onTitle, onClose, onSaved }: MobileComposerProps) {
  const capture = useMemoCapture("mobile");
  const { body, tags } = capture;
  const [noteSaving, setNoteSaving] = useState(false);
  const noteInFlight = useRef(false);
  const [showTags, setShowTags] = useState(false);
  const [noteError, setNoteError] = useState(false);
  const [pendingNoteId, setPendingNoteId] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const grabY = useRef<number | null>(null);
  const saving = noteSaving || capture.pending === "save";
  const busy = noteSaving || Boolean(capture.pending);
  const feedback = mode === "note" && noteError ? { role: "alert", text: "保存失败，请重试。" } : capture.feedback;

  const switchMode = (next: ComposeMode) => {
    if (next === mode || busy) return;
    if (mode === "note" && title.trim()) {
      capture.setBody(`${title.trim()}${body.trim() ? `\n\n${body}` : ""}`);
    }
    onTitle("");
    onMode(next);
  };

  const insert = (before: string, after = "") => {
    const node = textRef.current;
    const start = node?.selectionStart ?? body.length;
    const end = node?.selectionEnd ?? start;
    const selected = body.slice(start, end);
    const next = `${body.slice(0, start)}${before}${selected || (after ? "文字" : "")}${after}${body.slice(end)}`;
    capture.setBody(next);
    requestAnimationFrame(() => {
      if (!node?.isConnected || node.value !== next) return;
      node.focus();
      const cursor = start + before.length + (selected ? selected.length : after ? 2 : 0);
      node.setSelectionRange(cursor, cursor);
    });
  };

  const save = async () => {
    if (busy || noteInFlight.current) return;
    if (mode === "memo") {
      if (!body.trim()) return;
      textRef.current?.focus({ preventScroll: true });
      if (await capture.save()) setShowTags(false);
      return;
    }
    noteInFlight.current = true;
    setNoteSaving(true);
    setNoteError(false);
    try {
      const parsedTags = parseCaptureTags(tags);
      const item = pendingNoteId ? null : await createNote(userId, { title: title.trim() || undefined });
      const noteId = item?.id ?? pendingNoteId;
      if (!noteId) throw new Error("笔记草稿创建失败");
      if (item) setPendingNoteId(item.id);
      let saved = item;
      if (!item && title.trim()) saved = await saveItemMeta(userId, noteId, { title: title.trim() });
      if (body.trim()) saved = await saveItemContent(userId, noteId, body);
      if (parsedTags.length) saved = await saveItemMeta(userId, noteId, { tags: parsedTags });
      if (!saved) throw new Error("笔记草稿暂不可用，请重试");
      capture.clear();
      onSaved(saved);
    } catch {
      setNoteError(true);
    } finally {
      noteInFlight.current = false;
      setNoteSaving(false);
    }
  };

  const close = () => {
    if (!noteInFlight.current) onClose();
  };

  return <div className="m-compose-layer">
    <button type="button" className="m-veil" aria-label="关闭写入面板" disabled={noteSaving} onClick={close} />
    <section className={`m-composer ${mode === "memo" ? "m-composer--half" : "m-composer--full"}`} data-mode={mode} role="dialog" aria-modal="true" aria-label={mode === "memo" ? "记录 Memo" : "新建笔记"} onKeyDown={(event) => {
      if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.stopPropagation(); close(); }
    }}>
      {mode === "memo" && <button type="button" className="m-grab" aria-label="下拉关闭" onPointerDown={(event) => { grabY.current = event.clientY; }} onPointerUp={(event) => {
        if (grabY.current !== null && event.clientY - grabY.current > 48) close();
        grabY.current = null;
      }}><i /></button>}
      <header className="m-chead">
        <button type="button" className="m-cancel" disabled={noteSaving} onClick={close}>{mode === "memo" ? "关闭" : "取消"}</button>
        <div className="m-chead-center"><span className="m-seg2" role="group" aria-label="记录形态">
          <button type="button" aria-pressed={mode === "memo"} disabled={busy} onClick={() => switchMode("memo")}>Memo</button>
          <button type="button" aria-pressed={mode === "note"} disabled={busy} onClick={() => switchMode("note")}>笔记</button>
        </span></div>
        <button type="button" className="m-save" disabled={busy || (mode === "memo" && !body.trim())} onClick={() => void save()}>{saving ? "保存中" : "保存"}</button>
      </header>
      {mode === "note" && <input className="m-ntitle" value={title} disabled={noteSaving} onChange={(event) => onTitle(event.target.value)} placeholder="笔记标题" aria-label="笔记标题" />}
      <div className={`m-carea ${mode === "note" ? "note" : "memo"}`}>
        <textarea ref={textRef} value={body} disabled={noteSaving} onChange={(event) => capture.setBody(event.target.value)} autoFocus
          {...capture.compositionProps} onKeyDown={(event) => { if (mode === "memo") capture.onShortcut(event, () => void save()); }}
          onPaste={(event) => { if (!noteSaving) capture.onPaste(event, () => textRef.current); }}
          aria-label={mode === "memo" ? "Memo 正文" : "笔记正文"}
          placeholder={mode === "memo" ? "写下此刻想到的…" : "开始写笔记…"} />
      </div>
      {showTags && <div className="m-tag-input"><Tag /><input value={tags} disabled={noteSaving}
        onChange={(event) => capture.setTags(event.target.value)} {...capture.compositionProps}
        onKeyDown={(event) => { if (mode === "memo") capture.onShortcut(event, () => void save()); }}
        placeholder="用空格或逗号分隔标签" aria-label="标签" /></div>}
      {feedback && <p className="m-compose-feedback" role={feedback.role}>{feedback.text}</p>}
      <div className="m-ctools">
        {mode === "note" ? <><button type="button" disabled={noteSaving} aria-label="二级标题" onClick={() => insert("## ")}><Type /></button><button type="button" disabled={noteSaving} aria-label="加粗" onClick={() => insert("**", "**")}><Bold /></button><button type="button" disabled={noteSaving} aria-label="斜体" onClick={() => insert("*", "*")}><Italic /></button></>
          : <><button type="button" aria-label="插入待办" onClick={() => insert("- [ ] ")}><CheckSquare /></button><button type="button" disabled={busy} aria-label="附件" onClick={() => fileRef.current?.click()}><Paperclip /></button><button type="button" aria-label="标签" aria-pressed={showTags} onClick={() => setShowTags((show) => !show)}><Tag /></button></>}
        {mode === "note" && <button type="button" disabled={busy} aria-label="插入图片或附件" onClick={() => fileRef.current?.click()}><ImagePlus /></button>}
        <input ref={fileRef} type="file" multiple={mode === "memo"} hidden onChange={(event) => {
          if (!busy) void capture.attachFiles([...(event.currentTarget.files ?? [])], () => textRef.current);
          event.currentTarget.value = "";
        }} />
        <span className="grow" /><span className="m-compose-hint">{capture.pending === "upload" ? "上传中…" : mode === "memo" ? "今天 · 时间线" : "保存到草稿箱"}</span>
      </div>
    </section>
  </div>;
}
