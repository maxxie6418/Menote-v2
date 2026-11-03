import { useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { createMemo } from "../../services/contentService";
import { uploadAttachment } from "../../services/attachmentService";
import { insertAttachment } from "../editor";

/** Memo 快速输入（FR-IA-5）：默认单行提示行，点击展开多行并盖住「新建笔记」按钮的共享区域
 *  （不推移导航、不弹浮窗）；支持粘贴/上传图片（FR-MEMO-2，附件引用自动插入）；
 *  保存后留在当前页；收起保留未完成草稿。 */
export function QuickComposer({ userId, openSignal = 0 }: { userId: string; openSignal?: number }) {
  const [expanded, setExpanded] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (openSignal > 0) setExpanded(true);
  }, [openSignal]);

  const submit = async () => {
    const text = value.trim();
    if (!text || busy || uploading) return;
    setBusy(true);
    try {
      await createMemo(userId, text);
      setValue("");
      setError(null);
      setExpanded(false);
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
        const uploaded = await uploadAttachment(file);
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
      <button type="button" className="mn-memo-hint" onClick={() => setExpanded(true)}>
        <span>记一条 Memo…</span>
        <span className="mn-kbd">⌘↵</span>
      </button>
    );
  }

  return (
    <div className="mn-composer">
      <textarea
        ref={textRef} className="mn-composer-input" autoFocus rows={3}
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
