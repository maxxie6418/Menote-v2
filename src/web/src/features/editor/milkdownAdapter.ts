import { Editor, rootCtx, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, serializerCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { getMarkdown, replaceAll } from "@milkdown/kit/utils";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorAdapter } from "./EditorAdapter";

/**
 * Milkdown WYSIWYG 适配器（E4 PoC 准入通过后接入，负责人 2026-11-01 拍板）：
 * 语料往返 0 内容损坏；8 项等价规范化见 poc/evidence.json。上层只面向 EditorAdapter。
 * frontmatter 不进编辑器：YAML 由属性区在编辑器外管理（FR-PROP-1）。
 * 实现注记：视图属性经 editorViewOptionsCtx 在 config 期设置（editorViewCtx 此时未创建，
 * 不得在 config 期 get/update——曾导致编辑器挂载失败、文档区空白）；输入经 listener 插件。
 */
export class MilkdownWysiwygAdapter implements EditorAdapter {
  private editor: Editor | null = null;
  private disposed = false;

  static async create(
    host: HTMLElement,
    options: { initialMarkdown: string; onInput: (markdown: string) => void },
  ): Promise<MilkdownWysiwygAdapter> {
    const adapter = new MilkdownWysiwygAdapter();
    const editor = await Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, host);
        ctx.set(defaultValueCtx, options.initialMarkdown);
        ctx.update(editorViewOptionsCtx, (previous) => ({
          ...previous,
          attributes: { class: "md-body mn-editor-prose" },
        }));
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          if (!adapter.disposed) options.onInput(markdown);
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(listener)
      .create();
    if (adapter.disposed) {
      await editor.destroy();
      return adapter;
    }
    adapter.editor = editor;
    return adapter;
  }

  loadMarkdown(markdown: string): void {
    if (this.disposed || !this.editor) return;
    this.editor.action(replaceAll(markdown));
  }

  getMarkdown(): string {
    if (!this.editor) return "";
    return this.editor.action(getMarkdown());
  }

  getSelection(): { start: number; end: number } {
    if (!this.editor) return { start: 0, end: 0 };
    return this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const serializer = ctx.get(serializerCtx);
      const { from, to } = view.state.selection;
      const start = serializer(view.state.doc.cut(0, from)).length;
      const end = from === to ? start : serializer(view.state.doc.cut(0, to)).length;
      return { start, end };
    });
  }

  setSelection(start: number, end: number): void {
    if (!this.editor) return;
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const serializer = ctx.get(serializerCtx);
      const posFor = (offset: number) => {
        let found = 1;
        view.state.doc.descendants((node, nodePos) => {
          if (!node.isTextblock) return true;
          if (serializer(view.state.doc.cut(0, nodePos + node.nodeSize)).length >= offset) {
            found = nodePos + 1;
            return false;
          }
          return false;
        });
        return Math.min(found, view.state.doc.content.size);
      };
      const selection = TextSelection.create(view.state.doc, posFor(start), posFor(end));
      view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
      view.focus();
    });
  }

  caretRect(): { top: number; left: number; bottom: number } | null {
    if (!this.editor) return null;
    return this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const rect = view.coordsAtPos(view.state.selection.from);
      return { top: rect.top, left: rect.left, bottom: rect.bottom };
    });
  }

  focus(): void {
    if (!this.editor) return;
    this.editor.action((ctx) => {
      ctx.get(editorViewCtx).focus();
    });
  }

  async destroy(): Promise<void> {
    this.disposed = true;
    if (this.editor) {
      await this.editor.destroy();
      this.editor = null;
    }
  }
}
