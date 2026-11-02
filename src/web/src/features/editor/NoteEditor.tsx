import { useEffect, useRef, useState } from "react";
import type { EditorAdapter } from "./EditorAdapter";
import { TextareaSourceAdapter } from "./textareaAdapter";
import { MilkdownWysiwygAdapter } from "./milkdownAdapter";
import { fromEditorMarkdown, toEditorMarkdown } from "./attachmentRefs";
import { FormatBar } from "./FormatBar";
import { SlashMenu } from "./SlashMenu";
import { filterActions, type FormatAction } from "./formatActions";
import { activeInline, applyBlock, applySlash, insertAttachment, slashContext, toggleInline, type InlineAction } from "./markdownEdit";

export type EditorKind = "wysiwyg" | "source";

interface NoteEditorProps {
  mode: "edit" | "preview";
  /** 编辑形态：所见即所得（默认，FR-EDT-1）或源码（更多操作高级入口，FR-EDT-3）。 */
  kind: EditorKind;
  /** 本地库回声（保存回声/他端变更）：与编辑器当前值一致时静默；有未保存输入时不覆盖。 */
  externalMarkdown: string;
  onInput: (markdown: string) => void;
  /** 宿主注册取值器：切换模式/卸载/保存前由上层取真实当前值。 */
  registerGetMarkdown: (get: (() => string) | null) => void;
  /** 属性区/表格等结构化写回合并进编辑器（FR-PROP-3 统一链路）：强制刷新并清除脏标记。 */
  registerApplyExternal: (apply: ((markdown: string) => void) | null) => void;
  /** 上传一个文件并返回内容寻址结果；失败时返回错误文案，由底栏显示。 */
  uploadFile?: (file: File) => Promise<{ sha256: string; name: string } | { error: string }>;
}

/** 编辑器宿主（工程设计 3.2）：Milkdown 所见即所得（默认）/ 源码 textarea（高级入口）。 */
export function NoteEditor({ mode, kind, externalMarkdown, onInput, registerGetMarkdown, registerApplyExternal, uploadFile }: NoteEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<EditorAdapter | null>(null);
  const dirtyRef = useRef(false);
  const namesRef = useRef(new Map<string, string>());
  const [active, setActive] = useState<InlineAction[]>([]);
  const [slash, setSlash] = useState<{ query: string; index: number; top: number; left: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;

  const emit = (markdown: string) => {
    dirtyRef.current = true;
    onInputRef.current(fromEditorMarkdown(markdown, namesRef.current));
  };

  /** 外部写回（属性区增删、他端变更）会整篇 replaceAll，选区落到文末会把页面滚到底；
   *  这里在重载前后锁住文档滚动位置，避免「加个属性页面直接跳页尾」。 */
  const keepScroll = (apply: () => void) => {
    const scroller = hostRef.current?.closest<HTMLElement>(".mn-docbody") ?? null;
    const top = scroller?.scrollTop ?? 0;
    apply();
    if (!scroller) return;
    scroller.scrollTop = top;
    requestAnimationFrame(() => { scroller.scrollTop = top; });
  };

  useEffect(() => {
    if (mode !== "edit" || !hostRef.current) return;
    let cancelled = false;
    const host = hostRef.current;
    const initial = toEditorMarkdown(externalMarkdown, namesRef.current);

    if (kind === "source") {
      const adapter = new TextareaSourceAdapter(host, {
        initialMarkdown: initial,
        onInput: emit,
      });
      adapterRef.current = adapter;
      registerGetMarkdown(() => fromEditorMarkdown(adapter.getMarkdown(), namesRef.current));
      registerApplyExternal((markdown) => keepScroll(() => {
        dirtyRef.current = false;
        adapter.loadMarkdown(toEditorMarkdown(markdown, namesRef.current));
      }));
    } else {
      // Milkdown 异步创建；竞态以 cancelled 标记兜底（快速切型/卸载）。
      // 创建失败（如运行环境异常）回退源码适配器，编辑不中断。
      void MilkdownWysiwygAdapter.create(host, {
        initialMarkdown: initial,
        onInput: emit,
      }).then((adapter) => {
        if (cancelled) { void adapter.destroy(); return; }
        adapterRef.current = adapter;
        registerGetMarkdown(() => fromEditorMarkdown(adapter.getMarkdown(), namesRef.current));
        registerApplyExternal((markdown) => keepScroll(() => {
          dirtyRef.current = false;
          adapter.loadMarkdown(toEditorMarkdown(markdown, namesRef.current));
        }));
      }).catch((cause) => {
        console.error("WYSIWYG 创建失败，回退源码编辑：", cause);
        const fallback = new TextareaSourceAdapter(host, {
          initialMarkdown: initial,
          onInput: emit,
        });
        if (cancelled) { fallback.destroy(); return; }
        adapterRef.current = fallback;
        registerGetMarkdown(() => fromEditorMarkdown(fallback.getMarkdown(), namesRef.current));
        registerApplyExternal((markdown) => {
          dirtyRef.current = false;
          fallback.loadMarkdown(toEditorMarkdown(markdown, namesRef.current));
        });
      });
    }

    return () => {
      cancelled = true;
      registerGetMarkdown(null);
      registerApplyExternal(null);
      adapterRef.current?.destroy();
      adapterRef.current = null;
      dirtyRef.current = false;
    };
    // 仅按挂载/形态切换重建；内容流转走 loadMarkdown。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, kind]);

  const commit = (markdown: string, start: number, end: number) => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    dirtyRef.current = true;
    adapter.loadMarkdown(toEditorMarkdown(markdown, namesRef.current));
    adapter.setSelection(start, end);
    onInputRef.current(markdown);
  };

  const runAction = (action: FormatAction) => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    const markdown = fromEditorMarkdown(adapter.getMarkdown(), namesRef.current);
    const { start, end } = adapter.getSelection();
    if (action.id === "image") {
      if (kind === "wysiwyg" && slash && adapter instanceof MilkdownWysiwygAdapter) {
        adapter.applyFormat("image", slash.query.length + 1);
      }
      setSlash(null);
      fileInputRef.current?.click();
      return;
    }
    if (kind === "wysiwyg" && adapter instanceof MilkdownWysiwygAdapter) {
      const applied = adapter.applyFormat(action.id as Parameters<MilkdownWysiwygAdapter["applyFormat"]>[0], slash ? slash.query.length + 1 : 0);
      setSlash(null);
      if (applied) requestAnimationFrame(refreshSlash);
      return;
    }
    const context = slash ? slashContext(markdown, start) : null;
    const result = context
      ? applySlash(markdown, context, start, action.id as Parameters<typeof applySlash>[3])
      : action.group === "inline"
        ? toggleInline(markdown, start, end, action.id as InlineAction)
        : applyBlock(markdown, start, action.id as Parameters<typeof applyBlock>[2]);
    commit(result.markdown, result.selectionStart, result.selectionEnd);
    setSlash(null);
  };

  const placeFiles = async (files: File[], cursor: number) => {
    const adapter = adapterRef.current;
    if (!adapter || !uploadFile) return;
    let markdown = fromEditorMarkdown(adapter.getMarkdown(), namesRef.current);
    let caret = cursor;
    for (const file of files) {
      const uploaded = await uploadFile(file);
      if ("error" in uploaded) { onInputRef.current(markdown); return; }
      namesRef.current.set(uploaded.sha256, uploaded.name);
      const placed = insertAttachment(markdown, caret, uploaded, file.type.startsWith("image/"));
      markdown = placed.markdown;
      caret = placed.selectionStart;
    }
    commit(markdown, caret, caret);
  };

  const refreshSlash = () => {
    const adapter = adapterRef.current;
    if (!adapter || kind !== "wysiwyg") { setSlash(null); return; }
    const markdown = fromEditorMarkdown(adapter.getMarkdown(), namesRef.current);
    const { start, end } = adapter.getSelection();
    // WYSIWYG 直接读选区状态：空选区的 storedMarks（按下 B 还没输入）只有编辑器自己知道
    setActive(adapter instanceof MilkdownWysiwygAdapter ? adapter.activeMarks() : activeInline(markdown, start, end));
    if (start !== end) { setSlash(null); return; }
    const context = slashContext(markdown, start);
    if (!context) { setSlash(null); return; }
    const caret = adapter.caretRect();
    const host = hostRef.current?.getBoundingClientRect();
    const top = caret && host ? caret.bottom - host.top + hostRef.current!.scrollTop : 0;
    const left = caret && host ? caret.left - host.left : 0;
    setSlash({ query: context.query, index: 0, top, left });
  };

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || mode !== "edit") return;
    const visible = toEditorMarkdown(externalMarkdown, namesRef.current);
    if (fromEditorMarkdown(adapter.getMarkdown(), namesRef.current) === externalMarkdown) {
      dirtyRef.current = false;
      return;
    }
    if (!dirtyRef.current) adapter.loadMarkdown(visible);
  }, [externalMarkdown, mode]);

  return (
    <div className="mn-editor-wrap" data-dragging={dragging || undefined}>
      {mode === "edit" && kind === "wysiwyg" && <FormatBar active={active} disabled={false} onAction={runAction} />}
      <div
        ref={hostRef} className="mn-editor-host" data-mode={mode} data-kind={kind}
        onKeyUp={refreshSlash} onMouseUp={refreshSlash}
        onKeyDown={(event) => {
          if (!slash) return;
          const actions = filterActions(slash.query);
          if (actions.length === 0) return;
          if (event.key === "ArrowDown") { event.preventDefault(); setSlash({ ...slash, index: (slash.index + 1) % actions.length }); }
          if (event.key === "ArrowUp") { event.preventDefault(); setSlash({ ...slash, index: (slash.index - 1 + actions.length) % actions.length }); }
          if (event.key === "Enter" && actions[slash.index]) { event.preventDefault(); runAction(actions[slash.index]!); }
          if (event.key === "Escape") setSlash(null);
        }}
        onPaste={(event) => {
          const files = [...(event.clipboardData?.files ?? [])];
          if (files.length === 0 || !uploadFile) return;
          event.preventDefault();
          const cursor = adapterRef.current?.getSelection().start ?? 0;
          void placeFiles(files, cursor);
        }}
        onDragOver={(event) => { if (event.dataTransfer?.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          const files = [...(event.dataTransfer?.files ?? [])];
          if (files.length === 0) return;
          event.preventDefault();
          setDragging(false);
          void placeFiles(files, adapterRef.current?.getSelection().start ?? 0);
        }}
      />
      {slash && (
        <SlashMenu
          query={slash.query} activeIndex={slash.index} position={{ top: slash.top, left: slash.left }} onHover={(index) => setSlash({ ...slash, index })}
          onPick={(action) => runAction(action)}
        />
      )}
      <input ref={fileInputRef} type="file" accept="image/*" hidden aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void placeFiles([file], adapterRef.current?.getSelection().start ?? 0);
          event.target.value = "";
        }} />
    </div>
  );
}
