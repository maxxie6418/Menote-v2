import { useRef, useState } from "react";
import { Bold, CheckSquare, ChevronDown, ImagePlus, Italic, Paperclip, Tag, Type } from "lucide-react";
import type { Item } from "@menote/shared";
import { createMemo, createNote, saveItemContent, saveItemMeta } from "../services/contentService";
import { uploadAttachment } from "../services/attachmentService";

export type ComposeMode = "memo" | "note";

interface MobileComposerProps {
  userId: string;
  mode: ComposeMode;
  body: string;
  title: string;
  tags: string;
  onMode: (mode: ComposeMode) => void;
  onBody: (value: string) => void;
  onTitle: (value: string) => void;
  onTags: (value: string) => void;
  onClose: () => void;
  onSaved: (item: Item) => void;
}

export function MobileComposer({ userId, mode, body, title, tags, onMode, onBody, onTitle, onTags, onClose, onSaved }: MobileComposerProps) {
  const [saving, setSaving] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingNoteId, setPendingNoteId] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const grabY = useRef<number | null>(null);
  const parsedTags = [...new Set(tags.split(/[，,\s]+/).map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean))];

  const insert = (before: string, after = "") => {
    const node = textRef.current;
    const start = node?.selectionStart ?? body.length;
    const end = node?.selectionEnd ?? start;
    const selected = body.slice(start, end);
    const next = `${body.slice(0, start)}${before}${selected || (after ? "文字" : "")}${after}${body.slice(end)}`;
    onBody(next);
    requestAnimationFrame(() => {
      node?.focus();
      const cursor = start + before.length + (selected ? selected.length : after ? 2 : 0);
      node?.setSelectionRange(cursor, selected ? cursor : cursor);
    });
  };

  const save = async () => {
    if (saving || (!body.trim() && mode === "memo")) return;
    setSaving(true);
    setError(null);
    try {
      if (mode === "memo") {
        const item = await createMemo(userId, body, parsedTags);
        onSaved(item);
      } else {
        const item = pendingNoteId
          ? null
          : await createNote(userId, { title: title.trim() || undefined });
        const noteId = item?.id ?? pendingNoteId;
        if (!noteId) throw new Error("笔记草稿创建失败");
        if (item) setPendingNoteId(item.id);
        let saved = item;
        if (!item && title.trim()) saved = await saveItemMeta(userId, noteId, { title: title.trim() });
        if (body.trim()) saved = await saveItemContent(userId, noteId, body);
        if (parsedTags.length) saved = await saveItemMeta(userId, noteId, { tags: parsedTags });
        if (!saved) throw new Error("笔记草稿暂不可用，请重试");
        onSaved(saved);
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSaving(false);
    }
  };

  const insertAttachment = async (file?: File) => {
    if (!file) return;
    const result = await uploadAttachment(file);
    if ("error" in result) { setError("附件上传失败，请检查网络后重试。"); return; }
    insert(`![${result.name}](attachments/${result.sha256}--${result.name})`);
    setError(null);
  };

  return <div className="m-compose-layer">
    <button type="button" className="m-veil" aria-label="关闭写入面板" onClick={onClose} />
    <section className={`m-composer ${mode === "memo" ? "m-composer--half" : "m-composer--full"}`} data-mode={mode} role="dialog" aria-modal="true" aria-label={mode === "memo" ? "记录 Memo" : "新建笔记"}>
      {mode === "memo" && <button type="button" className="m-grab" aria-label="下拉关闭" onPointerDown={(event) => { grabY.current = event.clientY; }} onPointerUp={(event) => {
        if (grabY.current !== null && event.clientY - grabY.current > 48) onClose();
        grabY.current = null;
      }}><i /></button>}
      <header className="m-chead">
        <button type="button" className="m-cancel" onClick={onClose}>取消</button>
        <div className="m-chead-center"><span className="m-seg2" role="group" aria-label="记录形态">
          <button type="button" aria-pressed={mode === "memo"} onClick={() => onMode("memo")}>Memo</button>
          <button type="button" aria-pressed={mode === "note"} onClick={() => onMode("note")}>笔记</button>
        </span></div>
        <button type="button" className="m-save" disabled={saving || (mode === "memo" && !body.trim())} onClick={() => void save()}>{saving ? "保存中" : "保存"}</button>
      </header>
      {mode === "note" && <input className="m-ntitle" value={title} onChange={(event) => onTitle(event.target.value)} placeholder="笔记标题" aria-label="笔记标题" />}
      <div className={`m-carea ${mode === "note" ? "note" : "memo"}`}>
        <textarea ref={textRef} value={body} onChange={(event) => onBody(event.target.value)} autoFocus aria-label={mode === "memo" ? "Memo 正文" : "笔记正文"}
          placeholder={mode === "memo" ? "写下此刻想到的…" : "开始写笔记…"} />
      </div>
      {showTags && <div className="m-tag-input"><Tag /><input value={tags} onChange={(event) => onTags(event.target.value)} placeholder="用空格或逗号分隔标签" aria-label="标签" /></div>}
      {error && <p className="m-compose-error" role="alert">{error}</p>}
      <div className="m-ctools">
        {mode === "note" ? <><button type="button" aria-label="二级标题" onClick={() => insert("## ")}><Type /></button><button type="button" aria-label="加粗" onClick={() => insert("**", "**")}><Bold /></button><button type="button" aria-label="斜体" onClick={() => insert("*", "*")}><Italic /></button></>
          : <><button type="button" aria-label="插入待办" onClick={() => insert("- [ ] ")}><CheckSquare /></button><button type="button" aria-label="附件" onClick={() => fileRef.current?.click()}><Paperclip /></button><button type="button" aria-label="标签" aria-pressed={showTags} onClick={() => setShowTags((show) => !show)}><Tag /></button></>}
        {mode === "note" && <button type="button" aria-label="插入图片或附件" onClick={() => fileRef.current?.click()}><ImagePlus /></button>}
        <input ref={fileRef} type="file" hidden onChange={(event) => { void insertAttachment(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
        <span className="grow" /><span className="m-compose-hint">{mode === "memo" ? "今天 · 时间线" : "保存到草稿箱"}</span>
      </div>
    </section>
  </div>;
}
