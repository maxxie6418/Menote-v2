import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { getMarkdown, replaceAll } from "@milkdown/kit/utils";
import type { EditorAdapter } from "./EditorAdapter";

/**
 * Milkdown WYSIWYG 适配器（E4 PoC 准入通过后接入，负责人 2026-11-01 拍板）：
 * 语料往返 0 内容损坏；8 项等价规范化见 poc/evidence.json（列表标记统一、setext→ATX、
 * 缩进代码→fenced、硬换行风格、autolink 转义）。上层只面向 EditorAdapter，可整体更换。
 * frontmatter 不进编辑器：YAML 由属性区在编辑器外管理（FR-PROP-1）。
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
        ctx.update(editorViewCtx, (view) => {
          view.setProps({ attributes: { class: "md-body mn-editor-prose" } });
          return view;
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .create();
    if (adapter.disposed) {
      await editor.destroy();
      return adapter;
    }
    adapter.editor = editor;
    // 输入监听：Milkdown 序列化节流由上层自动保存承担（NFR-10）。
    editor.action((ctx) => {
      // onInput 以视图更新为信号；取值统一走 getMarkdown（上层防抖）。
      const view = ctx.get(editorViewCtx);
      const handler = () => {
        if (!adapter.disposed) options.onInput(adapter.getMarkdown());
      };
      view.setProps({
        dispatchTransaction: (transaction) => {
          const nextView = ctx.get(editorViewCtx);
          nextView.updateState(nextView.state.apply(transaction));
          if (transaction.docChanged) handler();
        },
      });
    });
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
