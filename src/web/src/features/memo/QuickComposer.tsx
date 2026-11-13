import { useEffect, useRef, useState } from "react";
import { ArrowUp, ImagePlus, Tags } from "../../icons";
import { createMemo } from "../../services/contentService";
import { useAllTags } from "../../services/contentHooks";
import { uploadAttachment } from "../../services/attachmentService";
import { insertAttachment } from "../editor";

/** Memo 快速输入（FR-IA-5）。
 *  - 侧栏：常驻两排输入面 + 框内提交按钮，原地写、原地交，不再弹浮层、不盖住「新建笔记」；
 *  - Memo 页时间线：expandedByDefault，直接出完整输入卡（标签 / 图片 / 收起）。
 *  两处共用同一份提交与图片粘贴逻辑（FR-MEMO-2），保存后留在当前页、保留未完成草稿。 */
export function QuickComposer({ userId, openSignal = 0, expandedByDefault = false, keepOpenAfterSubmit = false }: { userId: string; openSignal?: number; expandedByDefault?: boolean; keepOpenAfterSubmit?: boolean }) {
  const [expanded, setExpanded] = useState(expandedByDefault);
  const [focusOnExpand, setFocusOnExpand] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [newTag, setNewTag] = useState("");
  const allTags = useAllTags(userId);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (openSignal <= 0) return;
    if (expandedByDefault) { setFocusOnExpand(true); setExpanded(true); }
    else textRef.current?.focus();
  }, [openSignal, expandedByDefault]);

  const submit = async () => {
    const text = value.trim();
    if (!text || busy || uploading) return;
    setBusy(true);
    try {
      await createMemo(userId, text, tags);
      setValue("");
      setTags([]);
      setError(null);
      setExpanded(keepOpenAfterSubmit);
    } catch {
      // 保存失败保留草稿与标签，给出可见反馈（不静默吞错）。
      setError("Memo 保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  };

  /** 逐个上传并把附件引用插到光标处（FR-MEMO-2）：失败只留一行提示，正文不受影响。 */
  const placeFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const node = textRef.current;
    let markdown = value;
    let caret = node?.selectionStart ?? markdown.length;
    setUploading(true);
    setError(null);
    try {
      for (const file of files) {
        const uploaded = await uploadAttachment(userId, file);
        if ("error" in uploaded) {
          setError("图片上传失败，请检查网络后重试。");
          continue;
        }
        const placed = insertAttachment(markdown, caret, { sha256: uploaded.sha256, name: uploaded.name }, file.type.startsWith("image/"));
        markdown = placed.markdown;
        caret = placed.selectionStart;
        setValue(markdown);
      }
    } finally {
      setUploading(false);
      requestAnimationFrame(() => {
        node?.focus();
        node?.setSelectionRange(caret, caret);
      });
    }
  };

  if (!expandedByDefault) {
    /* 侧栏常驻两排输入面（2026-11-13）：不再点开盖住「新建笔记」的浮层，
       直接在原地写、原地交。提交按钮空态只留一个弱图标，有内容才浮出实底——
       否则一整条侧栏里会同时挂着两个亮色按钮（新建笔记 + 提交），谁是主操作说不清。 */
    const canSubmit = Boolean(value.trim()) && !busy && !uploading;
    return (
      <>
        <div className="mn-memo-dock" data-filled={canSubmit}>
          <textarea
            ref={textRef}
            className="mn-memo-dock-input"
            rows={2}
            placeholder="记一条 Memo…"
            aria-label="Memo 快速输入"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onPaste={(event) => {
              const files = [...(event.clipboardData?.files ?? [])];
              if (files.length === 0) return;
              event.preventDefault();
              void placeFiles(files);
            }}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void submit(); }
            }}
          />
          <button type="button" className="mn-memo-send" aria-label="提交 Memo" title="提交（Ctrl / ⌘ + Enter）"
            aria-disabled={!canSubmit} disabled={!canSubmit} onClick={() => void submit()}>
            <ArrowUp aria-hidden="true" />
          </button>
        </div>
        {error && <p className="mn-memo-dock-error" role="alert">{error}</p>}
      </>
    );
  }

  /* 时间线里收起后只留一行提示（侧栏不再走这条分支）。 */
  if (!expanded) {
    return (
      <button type="button" className="mn-memo-hint" onClick={() => { setFocusOnExpand(true); setExpanded(true); }}>
        <span>记一条 Memo…</span>
      </button>
    );
  }

  return (
    <div className="mn-composer">
      <textarea
        ref={textRef} className="mn-composer-input" autoFocus={focusOnExpand} rows={3}
        placeholder="记一条 Memo…（Esc 收起，可粘贴图片）"
        aria-label="Memo 快速输入"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onPaste={(event) => {
          const files = [...(event.clipboardData?.files ?? [])];
          if (files.length === 0) return;
          event.preventDefault();
          void placeFiles(files);
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void submit(); }
          if (event.key === "Escape") { event.preventDefault(); setExpanded(false); }
        }}
      />
      <div className="mn-composer-actions">
        <div className="mn-composer-tag-control">
          <button type="button" className="mn-composer-tool" aria-expanded={tagMenuOpen} aria-haspopup="dialog" onClick={() => setTagMenuOpen((open) => !open)}>
            <Tags aria-hidden="true" />标签{tags.length > 0 ? ` ${tags.length}` : ""}
          </button>
          {tagMenuOpen && <div className="mn-composer-tag-menu" role="dialog" aria-label="Memo 标签" onKeyDown={(event) => { if (event.key === "Escape") setTagMenuOpen(false); }}>
            {allTags.map((tag) => <label key={tag}><input type="checkbox" checked={tags.includes(tag)} onChange={(event) => setTags((current) => event.target.checked ? [...current, tag] : current.filter((item) => item !== tag))} />#{tag}</label>)}
            <form onSubmit={(event) => { event.preventDefault(); const tag = newTag.trim().replace(/^#/, ""); if (tag && !tags.includes(tag)) setTags((current) => [...current, tag]); setNewTag(""); }}>
              <input aria-label="添加标签" value={newTag} onChange={(event) => setNewTag(event.target.value)} placeholder="新标签" />
              <button type="submit" disabled={!newTag.trim()}>添加</button>
            </form>
          </div>}
        </div>
        <button type="button" className="mn-composer-tool" disabled={uploading} onClick={() => fileRef.current?.click()}>
          <ImagePlus aria-hidden="true" />
          {uploading ? "上传中…" : "图片"}
        </button>
        {error && <span className="mn-composer-error" role="alert">{error}</span>}
        <button type="button" className="mn-textbtn" onClick={() => setExpanded(false)}>收起</button>
        <button type="button" className="mn-composer-save" disabled={busy || uploading || !value.trim()}
          aria-disabled={busy || uploading || !value.trim()} onClick={() => void submit()}>
          {busy ? "保存中…" : "保存"}
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden aria-hidden="true"
        onChange={(event) => {
          void placeFiles([...(event.target.files ?? [])]);
          event.target.value = "";
        }} />
    </div>
  );
}
