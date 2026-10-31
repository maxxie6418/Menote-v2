import { useEffect, useRef } from "react";
import type { EditorAdapter, EditorAdapterCtor } from "./EditorAdapter";
import { TextareaSourceAdapter } from "./textareaAdapter";

const ADAPTER: EditorAdapterCtor = TextareaSourceAdapter;

interface NoteEditorProps {
  mode: "edit" | "preview";
  /** 本地库回声（保存回声/他端变更）：与编辑器当前值一致时静默；有未保存输入时不覆盖。 */
  externalMarkdown: string;
  onInput: (markdown: string) => void;
  /** 宿主注册取值器：切换模式/卸载/保存前由上层取真实当前值。 */
  registerGetMarkdown: (get: (() => string) | null) => void;
}

/** 编辑器宿主（工程设计 3.2）：仅编辑态挂载适配器；预览态由上层渲染 MarkdownView。 */
export function NoteEditor({ mode, externalMarkdown, onInput, registerGetMarkdown }: NoteEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<EditorAdapter | null>(null);
  const dirtyRef = useRef(false);
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;

  useEffect(() => {
    if (mode !== "edit" || !hostRef.current) return;
    const adapter = new ADAPTER(hostRef.current, {
      initialMarkdown: externalMarkdown,
      onInput: (value) => { dirtyRef.current = true; onInputRef.current(value); },
    });
    adapterRef.current = adapter;
    registerGetMarkdown(() => adapter.getMarkdown());
    return () => {
      registerGetMarkdown(null);
      adapterRef.current = null;
      adapter.destroy();
      dirtyRef.current = false;
    };
    // 仅按挂载/模式切换重建；内容流转走 loadMarkdown。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    if (adapter.getMarkdown() === externalMarkdown) {
      dirtyRef.current = false;
      return;
    }
    if (!dirtyRef.current) adapter.loadMarkdown(externalMarkdown);
  }, [externalMarkdown]);

  return <div ref={hostRef} className="mn-editor-host" data-mode={mode} />;
}
