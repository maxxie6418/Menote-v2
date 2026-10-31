import { useEffect, useRef, useState } from "react";
import type { EditorAdapter } from "./EditorAdapter";
import { TextareaSourceAdapter } from "./textareaAdapter";
import { MilkdownWysiwygAdapter } from "./milkdownAdapter";

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
}

/** 编辑器宿主（工程设计 3.2）：Milkdown 所见即所得（默认）/ 源码 textarea（高级入口）。 */
export function NoteEditor({ mode, kind, externalMarkdown, onInput, registerGetMarkdown, registerApplyExternal }: NoteEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<EditorAdapter | null>(null);
  const dirtyRef = useRef(false);
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;

  useEffect(() => {
    if (mode !== "edit" || !hostRef.current) return;
    let cancelled = false;
    const host = hostRef.current;
    const initial = externalMarkdown;

    if (kind === "source") {
      const adapter = new TextareaSourceAdapter(host, {
        initialMarkdown: initial,
        onInput: (value) => { dirtyRef.current = true; onInputRef.current(value); },
      });
      adapterRef.current = adapter;
      registerGetMarkdown(() => adapter.getMarkdown());
      registerApplyExternal((markdown) => {
        dirtyRef.current = false;
        adapter.loadMarkdown(markdown);
      });
    } else {
      // Milkdown 异步创建；竞态以 cancelled 标记兜底（快速切型/卸载）。
      void MilkdownWysiwygAdapter.create(host, {
        initialMarkdown: initial,
        onInput: (value) => { dirtyRef.current = true; onInputRef.current(value); },
      }).then((adapter) => {
        if (cancelled) { void adapter.destroy(); return; }
        adapterRef.current = adapter;
        registerGetMarkdown(() => adapter.getMarkdown());
        registerApplyExternal((markdown) => {
          dirtyRef.current = false;
          adapter.loadMarkdown(markdown);
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

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || mode !== "edit") return;
    if (adapter.getMarkdown() === externalMarkdown) {
      dirtyRef.current = false;
      return;
    }
    if (!dirtyRef.current) adapter.loadMarkdown(externalMarkdown);
  }, [externalMarkdown, mode]);

  return <div ref={hostRef} className="mn-editor-host" data-mode={mode} data-kind={kind} />;
}
