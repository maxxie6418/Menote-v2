import { useEffect, useRef, useState } from "react";
import { ArrowUp, ImagePlus, Tags } from "../../icons";
import { extractTags, toggleTagInText } from "@menote/shared";
import { useAllTags } from "../../services/contentHooks";
import { useMemoCapture } from "./useMemoCapture";

/** Memo 快速输入（FR-IA-5）。
 *  - 侧栏：常驻两排输入面 + 框内提交按钮，原地写、原地交，不再弹浮层、不盖住「新建笔记」；
 *  - Memo 页时间线：expandedByDefault，直接出完整输入卡（标签 / 图片 / 收起）。
 *  两处共用同一份提交与图片粘贴逻辑（FR-MEMO-2），保存后留在当前页、保留未完成草稿。 */
export function QuickComposer({ userId, openSignal = 0, expandedByDefault = false, keepOpenAfterSubmit = false }: { userId: string; openSignal?: number; expandedByDefault?: boolean; keepOpenAfterSubmit?: boolean }) {
  const [expanded, setExpanded] = useState(expandedByDefault);
  const [focusOnExpand, setFocusOnExpand] = useState(false);
  const capture = useMemoCapture(expandedByDefault ? "timeline" : "sidebar");
  const { body: value, feedback, setBody: setValue } = capture;
  const busy = capture.pending === "save";
  const uploading = capture.pending === "upload";
  const canSubmit = Boolean(value.trim()) && !capture.pending;
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [newTag, setNewTag] = useState("");
  const allTags = useAllTags(userId);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // FR-MEMO-9：标签写在正文里，这里显示的是正文解析出的标签。
  const tags = extractTags(value);

  useEffect(() => {
    if (openSignal <= 0) return;
    if (expandedByDefault) { setFocusOnExpand(true); setExpanded(true); }
    else textRef.current?.focus();
  }, [openSignal, expandedByDefault]);

  const submit = async () => {
    if (!canSubmit) return;
    textRef.current?.focus({ preventScroll: true });
    if (await capture.save()) {
      if (!keepOpenAfterSubmit) setExpanded(false);
      setTagMenuOpen(false);
      setNewTag("");
    }
  };

  /** 标签快捷入口：点一下就在正文里写入或移除 `#标签`，正文始终是标签的唯一载体（FR-MEMO-9）。 */
  const applyTag = (tag: string) => {
    setValue((current) => toggleTagInText(current, tag));
    requestAnimationFrame(() => {
      const node = textRef.current;
      if (!node?.isConnected) return;
      node.focus();
      const caret = node.value.length;
      node.setSelectionRange(caret, caret);
    });
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => capture.onPaste(event, () => textRef.current);

  if (!expandedByDefault) {
    /* 侧栏常驻两排输入面（2026-11-13）：不再点开盖住「新建笔记」的浮层，
       直接在原地写、原地交。提交按钮空态只留一个弱图标，有内容才浮出实底——
       否则一整条侧栏里会同时挂着两个亮色按钮（新建笔记 + 提交），谁是主操作说不清。 */
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
            onPaste={handlePaste}
            {...capture.compositionProps}
            onKeyDown={(event) => capture.onShortcut(event, () => void submit())}
          />
          <button type="button" className="mn-memo-send" aria-label="提交 Memo" title="提交（Ctrl / ⌘ + Enter）"
            aria-disabled={!canSubmit} disabled={!canSubmit} onClick={() => void submit()}>
            <ArrowUp aria-hidden="true" />
          </button>
        </div>
        {feedback && <p className="mn-memo-dock-feedback" role={feedback.role}>{feedback.text}</p>}
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
        onPaste={handlePaste}
        {...capture.compositionProps}
        onKeyDown={(event) => capture.onShortcut(event, () => void submit(), () => setExpanded(false))}
      />
      <div className="mn-composer-actions">
        <div className="mn-composer-tag-control">
          <button type="button" className="mn-composer-tool" aria-expanded={tagMenuOpen} aria-haspopup="dialog" onClick={() => setTagMenuOpen((open) => !open)}>
            <Tags aria-hidden="true" />标签{tags.length > 0 ? ` ${tags.length}` : ""}
          </button>
          {tagMenuOpen && <div className="mn-composer-tag-menu" role="dialog" aria-label="Memo 标签" onKeyDown={(event) => { if (event.key === "Escape") setTagMenuOpen(false); }}>
            <p className="mn-composer-tag-hint">点标签即在正文里写入或移除</p>
            {allTags.map((tag) => <button key={tag} type="button" className="mn-composer-tag-option" aria-pressed={tags.includes(tag)} onClick={() => applyTag(tag)}>#{tag}</button>)}
            <form onSubmit={(event) => { event.preventDefault(); const tag = newTag.trim().replace(/^#/, ""); if (tag) { applyTag(tag); setNewTag(""); } }}>
              <input aria-label="添加标签" value={newTag} onChange={(event) => setNewTag(event.target.value)} placeholder="新标签" />
              <button type="submit" disabled={!newTag.trim()}>添加</button>
            </form>
          </div>}
        </div>
        <button type="button" className="mn-composer-tool" disabled={Boolean(capture.pending)} onClick={() => fileRef.current?.click()}>
          <ImagePlus aria-hidden="true" />
          {uploading ? "上传中…" : "图片"}
        </button>
        {feedback && <span className="mn-composer-feedback" role={feedback.role}>{feedback.text}</span>}
        <button type="button" className="mn-textbtn" onClick={() => setExpanded(false)}>收起</button>
        <button type="button" className="mn-composer-save" disabled={!canSubmit}
          aria-disabled={!canSubmit} onClick={() => void submit()}>
          {busy ? "保存中…" : "保存"}
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden aria-hidden="true"
        onChange={(event) => {
          void capture.attachFiles([...(event.target.files ?? [])], () => textRef.current);
          event.target.value = "";
        }} />
    </div>
  );
}
