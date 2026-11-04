import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { EditorAdapter } from "./EditorAdapter";
import { TextareaSourceAdapter } from "./textareaAdapter";
import { MilkdownWysiwygAdapter } from "./milkdownAdapter";
import { fromEditorMarkdown, toEditorMarkdown } from "./attachmentRefs";
import { FormatBar } from "./FormatBar";
import { SlashMenu } from "./SlashMenu";
import { TableBlockToolbar } from "./TableBlockToolbar";
import { ContextMenu, type ContextMenuAction } from "../../components/ui/ContextMenu";
import { SelectionFormatBar } from "./SelectionFormatBar";
import { filterActions, FORMAT_ACTIONS, type FormatAction } from "./formatActions";
import { activeInline, applyBlock, applySlash, insertAttachment, safeAttachmentName, slashContext, toggleInline, type InlineAction } from "./markdownEdit";

export type EditorKind = "wysiwyg" | "source";

/** 上传态：只用于底部的进度条与错误提示，不进文档内容。 */
interface UploadTask { id: string; name: string; percent: number; error?: string }

const UPLOAD_ERRORS: Record<string, string> = {
  invalid_attachment: "文件为空或超过 20MB",
  unauthorized: "登录状态已失效，请重新登录后重试",
  network: "网络中断",
  aborted: "已取消",
};

/** 行内格式按下态比较：内容没变就不换数组引用，避免每次 keyup 都白白触发一次重渲染。 */
function sameActions(previous: InlineAction[], next: InlineAction[]): boolean {
  return previous.length === next.length && previous.every((item, index) => item === next[index]);
}

interface NoteEditorProps {
  mode: "edit" | "preview";
  /** 编辑形态：所见即所得（默认，FR-EDT-1）或源码（更多操作高级入口，FR-EDT-3）。 */
  kind: EditorKind;
  /** 本地库回声（保存回声/他端变更）：与编辑器当前值一致时静默；有未保存输入时不覆盖。 */
  externalMarkdown: string;
  /** 脏信号：只表示「正文变了」，**不带正文**（FR-EDT-10）。
   *  键入路径不再整篇序列化；落盘/导出/切模式/离开文档前的全量正文统一走 registerGetMarkdown。 */
  onInput: () => void;
  /** 宿主注册取值器：切换模式/卸载/保存前由上层取真实当前值。 */
  registerGetMarkdown: (get: (() => string) | null) => void;
  /** 属性区/表格等结构化写回合并进编辑器（FR-PROP-3 统一链路）：强制刷新并清除脏标记。 */
  registerApplyExternal: (apply: ((markdown: string) => void) | null) => void;
  /** 上传一个文件并返回内容寻址结果；失败时返回错误文案，由底栏显示。 */
  uploadFile?: (file: File, onProgress?: (percent: number) => void) => Promise<{ sha256: string; name: string } | { error: string }>;
}

/** 编辑器宿主（工程设计 3.2）：Milkdown 所见即所得（默认）/ 源码 textarea（高级入口）。 */
export function NoteEditor({ mode, kind, externalMarkdown, onInput, registerGetMarkdown, registerApplyExternal, uploadFile }: NoteEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<EditorAdapter | null>(null);
  const dirtyRef = useRef(false);
  const namesRef = useRef(new Map<string, string>());
  const [active, setActive] = useState<InlineAction[]>([]);
  const [selectionBar, setSelectionBar] = useState<{ x: number; y: number } | null>(null);
  const [selectionMenu, setSelectionMenu] = useState<{ x: number; y: number } | null>(null);
  // from：触发「/」菜单的那个斜杠在正文中的位置。所见即所得走原生选区用不到它，
  // 源码态按文本算上下文时要用（applySlash 靠它剥掉「/过滤词」）。
  const [slash, setSlash] = useState<{ query: string; from: number; index: number; top: number; left: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;

  /** 脏信号：只报「正文变了」，不携带正文（FR-EDT-10）。
   *  每次键入整篇序列化是长文档卡顿的主因，正文统一在落盘出口（registerGetMarkdown）取全量。 */
  const emit = () => {
    dirtyRef.current = true;
    onInputRef.current();
  };

  /** 持久化用的正文（FR-EDT-8）：所见即所得走「保留原文」版本，源码态就是用户输入。 */
  const persistedMarkdown = (adapter: EditorAdapter): string => {
    const raw = adapter.getPreservedMarkdown?.() ?? adapter.getMarkdown();
    return fromEditorMarkdown(raw, namesRef.current);
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
      registerGetMarkdown(() => persistedMarkdown(adapter));
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
        registerGetMarkdown(() => persistedMarkdown(adapter));
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
    // 本地改动：基线沿用「保留原文」的结果，未触碰块继续保留原始字节（FR-EDT-8）。
    adapter.loadMarkdown(toEditorMarkdown(markdown, namesRef.current), { keepBaseline: true });
    adapter.setSelection(start, end);
    onInputRef.current();
  };

  const runAction = (action: FormatAction, fromSlash = false) => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    if (action.id === "image") {
      if (fromSlash && kind === "wysiwyg" && slash && adapter instanceof MilkdownWysiwygAdapter) {
        adapter.applyFormat("image", slash.query.length + 1);
      }
      setSlash(null);
      fileInputRef.current?.click();
      return;
    }
    if (kind === "wysiwyg" && adapter instanceof MilkdownWysiwygAdapter) {
      // 所见即所得走编辑器原生选区，**不取整篇正文**（FR-EDT-10）。
      const applied = adapter.applyFormat(action.id as Parameters<MilkdownWysiwygAdapter["applyFormat"]>[0], fromSlash && slash ? slash.query.length + 1 : 0);
      setSlash(null);
      setSelectionBar(null);
      setSelectionMenu(null);
      if (applied) requestAnimationFrame(refreshSlash);
      return;
    }
    // 源码态才需要整篇文本（textarea 读 value 是 O(1)，不是序列化开销）。
    const markdown = fromEditorMarkdown(adapter.getMarkdown(), namesRef.current);
    const { start, end } = adapter.getSelection();
    const context = fromSlash && slash ? { from: slash.from, query: slash.query } : slashContext(markdown, start);
    const result = context
      ? applySlash(markdown, context, start, action.id as Parameters<typeof applySlash>[3])
      : action.group === "inline"
        ? toggleInline(markdown, start, end, action.id as InlineAction)
        : applyBlock(markdown, start, action.id as Parameters<typeof applyBlock>[2]);
    commit(result.markdown, result.selectionStart, result.selectionEnd);
    setSlash(null);
  };

  /** 逐个上传再插入：先出进度条，成功才写进正文（失败留一行红字，正文不受影响）。 */
  const placeFiles = async (files: File[], cursor: number) => {
    const adapter = adapterRef.current;
    if (!adapter || !uploadFile) return;
    let markdown = fromEditorMarkdown(adapter.getMarkdown(), namesRef.current);
    let caret = cursor;
    const tasks: UploadTask[] = files.map((file, index) => ({
      id: `${Date.now()}-${index}`, name: file.name, percent: 0,
    }));
    setUploads((previous) => [...previous, ...tasks]);
    for (const [index, file] of files.entries()) {
      const task = tasks[index]!;
      const patch = (next: Partial<UploadTask>) => setUploads((previous) =>
        previous.map((item) => (item.id === task.id ? { ...item, ...next } : item)));
      const uploaded = await uploadFile(file, (percent) => patch({ percent }));
      if ("error" in uploaded) {
        patch({ error: uploaded.error });
        onInputRef.current();
        return;
      }
      // 名字净化后再入库：往返映射与正文引用必须用同一个名字
      const name = safeAttachmentName(uploaded.name);
      namesRef.current.set(uploaded.sha256, name);
      const placed = insertAttachment(markdown, caret, { sha256: uploaded.sha256, name }, file.type.startsWith("image/"));
      markdown = placed.markdown;
      caret = placed.selectionStart;
      setUploads((previous) => previous.filter((item) => item.id !== task.id));
    }
    commit(markdown, caret, caret);
  };

  const refreshSlash = () => {
    const adapter = adapterRef.current;
    if (!adapter) { setSlash(null); return; }
    if (kind === "source") {
      // 源码态：textarea 读 value 是 O(1)，不算整篇序列化，上下文仍按文本算。
      // 源码态不弹「/」菜单（方向键/回车必须留给 textarea 本身），保持既有行为不变。
      const markdown = fromEditorMarkdown(adapter.getMarkdown(), namesRef.current);
      const { start, end } = adapter.getSelection();
      const next = activeInline(markdown, start, end);
      setActive((previous) => (sameActions(previous, next) ? previous : next));
      setSlash(null);
      return;
    }
    // 所见即所得：用编辑器原生选区算「/」过滤词与行内格式按下态，**不整篇序列化**（FR-EDT-10）。
    // 空选区的 storedMarks（按下 B 还没输入）只有编辑器自己知道，所以按下态仍走 activeMarks()。
    const marks = adapter instanceof MilkdownWysiwygAdapter ? adapter.activeMarks() : [];
    setActive((previous) => (sameActions(previous, marks) ? previous : marks));
    const { start, end } = adapter.getSelection();
    if (start !== end) { setSlash(null); return; }
    // 拿不到原生上下文就退化为「不显示菜单」，绝不用整篇序列化兜底。
    // 例外：所见即所得创建失败时的源码适配器兜底——那里读 textarea.value 是 O(1)，按文本算即可（保持既有行为）。
    const context = adapter.getSlashContext?.()
      ?? (adapter instanceof TextareaSourceAdapter ? slashContext(adapter.getMarkdown(), start) : null);
    if (!context) { setSlash(null); return; }
    const caret = adapter.caretRect();
    const host = hostRef.current?.getBoundingClientRect();
    const top = caret && host ? caret.bottom - host.top + hostRef.current!.scrollTop : 0;
    const left = caret && host ? caret.left - host.left : 0;
    setSlash({ query: context.query, from: start, index: 0, top, left });
  };

  const refreshSelectionBar = () => {
    if (mode !== "edit" || kind !== "wysiwyg") { setSelectionBar(null); return; }
    const host = hostRef.current;
    const selection = window.getSelection();
    if (!host || !selection || selection.isCollapsed || selection.rangeCount === 0
      || !selection.anchorNode || !selection.focusNode
      || !host.contains(selection.anchorNode) || !host.contains(selection.focusNode)) {
      setSelectionBar(null);
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) { setSelectionBar(null); return; }
    const next = { x: rect.left + rect.width / 2, y: rect.top - 6 };
    setSelectionBar((previous) => previous?.x === next.x && previous.y === next.y ? previous : next);
    const adapter = adapterRef.current;
    if (adapter instanceof MilkdownWysiwygAdapter) {
      const marks = adapter.activeMarks();
      setActive((previous) => sameActions(previous, marks) ? previous : marks);
    }
  };

  const selectionMenuActions: ContextMenuAction[] = FORMAT_ACTIONS.map((action, index) => ({
    label: action.label,
    separatorBefore: index === 5,
    onSelect: () => runAction(action),
  }));

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || mode !== "edit") return;
    const visible = toEditorMarkdown(externalMarkdown, namesRef.current);
    // 「我刚写进去的内容」也会从外部回声回来（FR-EDT-8 的保留原文版本与编辑态文本不同），
    // 用适配器的等价判断避免把本地内容当成他端变更整篇重载。
    const same = adapter.isSameContent
      ? adapter.isSameContent(visible)
      : fromEditorMarkdown(adapter.getMarkdown(), namesRef.current) === externalMarkdown;
    if (same) {
      dirtyRef.current = false;
      return;
    }
    if (!dirtyRef.current) adapter.loadMarkdown(visible);
  }, [externalMarkdown, mode]);

  return (
    <div className="mn-editor-wrap" data-dragging={dragging || undefined}>
      {mode === "edit" && kind === "wysiwyg" && <FormatBar active={active} disabled={false} onAction={(action) => runAction(action)} />}
      {selectionBar && mode === "edit" && kind === "wysiwyg" && (
        <SelectionFormatBar x={selectionBar.x} y={selectionBar.y} active={active}
          actions={FORMAT_ACTIONS.filter((action) => action.group === "inline")}
          onAction={(action) => runAction(action)} />
      )}
      {/* 表格块操作（FR-EDT-9）：浮出工具条 + 右键菜单，同一套命令。 */}
      {mode === "edit" && kind === "wysiwyg" && (
        <TableBlockToolbar getAdapter={() => adapterRef.current} hostRef={hostRef} />
      )}
      <div
        ref={hostRef} className="mn-editor-host" data-mode={mode} data-kind={kind}
        onKeyUp={() => { refreshSlash(); refreshSelectionBar(); }}
        onMouseUp={() => { refreshSlash(); refreshSelectionBar(); }}
        onContextMenu={(event) => {
          if (kind !== "wysiwyg" || mode !== "edit") return;
          const selection = window.getSelection();
          const host = hostRef.current;
          if (!host || !selection || selection.isCollapsed || selection.rangeCount === 0
            || !selection.anchorNode || !selection.focusNode
            || !host.contains(selection.anchorNode) || !host.contains(selection.focusNode)) return;
          event.preventDefault();
          setSelectionBar(null);
          setSelectionMenu({ x: event.clientX, y: event.clientY });
        }}
        onMouseDown={(event) => { if (event.button === 0) setSelectionMenu(null); }}
        onKeyDown={(event) => {
          if (!slash) return;
          const actions = filterActions(slash.query);
          if (actions.length === 0) return;
          if (event.key === "ArrowDown") { event.preventDefault(); setSlash({ ...slash, index: (slash.index + 1) % actions.length }); }
          if (event.key === "ArrowUp") { event.preventDefault(); setSlash({ ...slash, index: (slash.index - 1 + actions.length) % actions.length }); }
          if (event.key === "Enter" && actions[slash.index]) { event.preventDefault(); runAction(actions[slash.index]!, true); }
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
      {uploads.length > 0 && (
        <div className="mn-uploadstack" role="status" aria-live="polite" aria-label="附件上传">
          {uploads.map((task) => (
            <div key={task.id} className="mn-uploadrow" data-error={task.error ? "true" : undefined}>
              <span className="mn-uploadname" title={task.name}>{task.name}</span>
              {task.error ? (
                <>
                  <span className="mn-uploaderror">上传失败：{UPLOAD_ERRORS[task.error] ?? task.error}</span>
                  <button type="button" className="mn-iconbtn" aria-label="忽略这条上传失败"
                    onClick={() => setUploads((previous) => previous.filter((item) => item.id !== task.id))}>
                    <X aria-hidden="true" />
                  </button>
                </>
              ) : (
                <>
                  <span className="mn-uploadpct">{task.percent}%</span>
                  <progress className="mn-uploadbar" value={task.percent} max={100} aria-label={`${task.name} 上传进度`} />
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {slash && (
        <SlashMenu
          query={slash.query} activeIndex={slash.index} position={{ top: slash.top, left: slash.left }} onHover={(index) => setSlash({ ...slash, index })}
          onPick={(action) => runAction(action, true)}
        />
      )}
      {selectionMenu && (
        <ContextMenu x={selectionMenu.x} y={selectionMenu.y} label="文字格式"
          actions={selectionMenuActions} onClose={() => setSelectionMenu(null)} returnFocus={hostRef.current} />
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
