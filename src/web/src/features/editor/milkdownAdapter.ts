import { Editor, rootCtx, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, serializerCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { getMarkdown, replaceAll } from "@milkdown/kit/utils";
import { TextSelection } from "@milkdown/kit/prose/state";
import { lift, setBlockType, wrapIn } from "@milkdown/kit/prose/commands";
import { wrapInList } from "@milkdown/kit/prose/schema-list";
import type { EditorAdapter } from "./EditorAdapter";
import type { BlockAction, InlineAction } from "./markdownEdit";

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

  /** WYSIWYG 格式操作直接作用于 ProseMirror 原生选区，避免 Markdown 字符偏移造成错位。 */
  applyFormat(action: InlineAction | BlockAction, slashLength = 0): boolean {
    if (!this.editor) return false;
    return this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      let state = view.state;
      const { from } = state.selection;
      let tr = state.tr;
      if (slashLength > 0) {
        const start = Math.max(1, from - slashLength);
        view.dispatch(tr.delete(start, from).setSelection(TextSelection.create(state.doc, start)));
        state = view.state;
        tr = state.tr;
      }
      const current = tr.selection;
      const markNames: Partial<Record<InlineAction, string>> = {
        bold: "strong", italic: "emphasis", strike: "strike_through", code: "inlineCode", link: "link",
      };
      if (action in markNames) {
        const markName = markNames[action as InlineAction];
        const mark = markName && state.schema.marks[markName];
        if (!mark) return false;
        if (action === "link" && current.empty) {
          tr = tr.insertText("链接", current.from).addMark(current.from, current.from + 2, mark.create({ href: "" }));
          tr = tr.setSelection(TextSelection.create(tr.doc, current.from, current.from + 2));
        } else {
          const active = current.empty
            ? (state.storedMarks ?? state.selection.$from.marks()).some((item) => item.type === mark)
            : state.doc.rangeHasMark(current.from, current.to, mark);
          if (active) tr = current.empty
            ? tr.removeStoredMark(mark)
            : tr.removeMark(current.from, current.to, mark);
          else tr = current.empty
            ? tr.addStoredMark(mark.create(action === "link" ? { href: "" } : undefined))
            : tr.addMark(current.from, current.to, mark.create(action === "link" ? { href: "" } : undefined));
        }
      } else {
        const nodes = state.schema.nodes;
        if (action === "heading1" || action === "heading2" || action === "heading3") {
          const type = nodes.heading;
          if (!type) return false;
          const level = Number(action.slice(-1));
          const currentLevel = current.$from.parent.type === type ? current.$from.parent.attrs.level : 0;
          const target = currentLevel === level ? nodes.paragraph : type;
          if (!target) return false;
          setBlockType(target, currentLevel === level ? undefined : { level })(state, (next) => { tr = next; });
        } else if (action === "quote") {
          const type = nodes.blockquote;
          if (!type) return false;
          const command = current.$from.parent.type === type ? lift : wrapIn(type);
          command(state, (next) => { tr = next; });
        } else if (["bullet", "ordered", "task"].includes(action)) {
          const type = action === "ordered" ? nodes.ordered_list : nodes.bullet_list;
          if (!type) return false;
          wrapInList(type)(state, (next) => { tr = next; });
          if (action === "task" && tr.docChanged) {
            const taskItems: number[] = [];
            const start = tr.mapping.map(current.from);
            const end = tr.mapping.map(current.to);
            tr.doc.nodesBetween(start, Math.max(start + 1, end), (node, pos) => {
              if (node.type.name === "list_item") taskItems.push(pos);
            });
            for (const pos of taskItems) {
              const item = tr.doc.nodeAt(pos);
              if (item) tr = tr.setNodeMarkup(pos, undefined, { ...item.attrs, checked: false });
            }
          }
        } else if (action === "hr" && nodes.horizontal_rule) {
          tr = tr.replaceSelectionWith(nodes.horizontal_rule.create()).scrollIntoView();
        } else if (action === "codeblock" && nodes.code_block) {
          setBlockType(nodes.code_block)(state, (next) => { tr = next; });
        } else if (action === "table" && nodes.table && nodes.table_row && nodes.table_cell && nodes.table_header_row && nodes.table_header) {
          const header = nodes.table_header.createAndFill();
          const cell = () => nodes.table_cell!.createAndFill();
          if (!header) return false;
          const bodyRows = [0, 1].map(() => [cell(), cell(), cell()]);
          if (bodyRows.some((row) => row.some((item) => !item))) return false;
          const rows = [nodes.table_header_row.create(null, [header, header, header]), ...bodyRows.map((row) => nodes.table_row!.create(null, row as NonNullable<(typeof row)[number]>[]))];
          tr = tr.replaceSelectionWith(nodes.table.create(null, rows)).scrollIntoView();
        } else return false;
      }
      if (tr.docChanged || tr.selectionSet || tr.storedMarksSet) view.dispatch(tr.scrollIntoView());
      view.focus();
      return true;
    });
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
