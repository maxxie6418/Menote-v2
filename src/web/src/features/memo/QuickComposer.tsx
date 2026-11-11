import { useEffect, useRef, useState } from "react";
import { ImagePlus, Tags } from "../../icons";
import { createMemo } from "../../services/contentService";
import { useAllTags } from "../../services/contentHooks";
import { uploadAttachment } from "../../services/attachmentService";
import { insertAttachment } from "../editor";

/** Memo 快速输入（FR-IA-5）：默认单行提示行，点击展开多行并盖住「新建笔记」按钮的共享区域
 *  （不推移导航、不弹浮窗）；支持粘贴/上传图片（FR-MEMO-2，附件引用自动插入）；
 *  保存后留在当前页；收起保留未完成草稿。 */
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
    if (openSignal > 0) { setFocusOnExpand(true); setExpanded(true); }
  }, [openSignal]);

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

  if (!expanded) {
    return (
      <button type="button" className="mn-memo-hint" onClick={() => { setFocusOnExpand(true); setExpanded(true); }}>
        <span>记一条 Memo…</span>
        <span className="mn-kbd">⌘↵</span>
      </button>
    );
  }

  return (
    <div className="mn-composer">
      <textarea
        ref={textRef} className="mn-composer-input" autoFocus={focusOnExpand} rows={3}
        placeholder="记一条 Memo…（⌘/Ctrl+Enter 保存，Esc 收起，可粘贴图片）"
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
