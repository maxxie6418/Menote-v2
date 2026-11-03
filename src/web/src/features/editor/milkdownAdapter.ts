import { Editor, rootCtx, defaultValueCtx, editorViewCtx, editorViewOptionsCtx, serializerCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { getMarkdown, replaceAll } from "@milkdown/kit/utils";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { Node } from "@milkdown/kit/prose/model";
import { lift, setBlockType, wrapIn } from "@milkdown/kit/prose/commands";
import { wrapInList } from "@milkdown/kit/prose/schema-list";
import { perfProbe } from "../../lib/perfProbe";
import { RoundTripGuard } from "./roundtrip";
import { locateTable, runTableCommand as runTableCommandOn, type TableCommandId, type TableContext } from "./tableCommands";
import type { EditorAdapter } from "./EditorAdapter";
import type { BlockAction, InlineAction } from "./markdownEdit";

/**
 * markdown 前缀长度（UTF-16 字符数）。
 *
 * `doc.cut(0, upto)` 落在**列表内部**时，Milkdown 的 gfm 预设序列化任务列表项会读取空父节点
 * 并抛错（`Cannot read properties of undefined`）。切点落在列表内部是常态（列表项里的光标），
 * 所以这里兜一层：失败时按正文字符占比折算，保持与真实 markdown 偏移同一量纲——
 * 偏移一点可以接受，抛错会直接中断编辑。
 */
function markdownPrefix(
  serializer: (content: Node) => string,
  doc: Node,
  upto: number,
  scale: () => { total: number; totalText: number },
): number {
  try {
    return serializer(doc.cut(0, upto)).length;
  } catch {
    const { total, totalText } = scale();
    if (totalText <= 0) return 0;
    const text = doc.textBetween(0, upto, "\n", "\n").length;
    return Math.round((text / totalText) * total);
  }
}

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
  /** 诊断打点用的按键监听拆卸函数（FR-EDT-10）。 */
  private detachKeyListener: (() => void) | null = null;
  /** 往返保真守卫（FR-EDT-8）：基线是上一次可信文本。 */
  private guard: RoundTripGuard | null = null;
  /** 编辑器最近一次规范序列化结果（编辑态正文空间）。 */
  private canonicalText = "";
  /** 最近一次算出的「保留原文」文本（持久化用）。 */
  private preservedText: string | null = null;

  static async create(
    host: HTMLElement,
    options: { initialMarkdown: string; onInput: (markdown: string) => void },
  ): Promise<MilkdownWysiwygAdapter> {
    const adapter = new MilkdownWysiwygAdapter();
    // 键入延迟基线（FR-EDT-10 / W0）：按一次键 → 序列化完成。诊断关闭时不打点。
    let lastKeyAt = 0;
    const onKeyDown = () => {
      if (perfProbe.isEnabled) lastKeyAt = performance.now();
    };
    host.addEventListener("keydown", onKeyDown, true);
    const editor = await Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, host);
        ctx.set(defaultValueCtx, options.initialMarkdown);
        ctx.update(editorViewOptionsCtx, (previous) => ({
          ...previous,
          attributes: { class: "md-body mn-editor-prose" },
        }));
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          if (adapter.disposed) return;
          adapter.canonicalText = markdown;
          adapter.preservedText = null;
          if (perfProbe.isEnabled && lastKeyAt > 0) {
            perfProbe.record("editor.keyToMarkdown", performance.now() - lastKeyAt);
            lastKeyAt = 0;
          }
          options.onInput(markdown);
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(listener)
      .create();
    if (adapter.disposed) {
      host.removeEventListener("keydown", onKeyDown, true);
      await editor.destroy();
      return adapter;
    }
    adapter.editor = editor;
    adapter.detachKeyListener = () => host.removeEventListener("keydown", onKeyDown, true);
    adapter.guard = new RoundTripGuard(options.initialMarkdown);
    adapter.canonicalText = options.initialMarkdown;
    adapter.preservedText = options.initialMarkdown;
    return adapter;
  }

  /**
   * 载入文本。
   * - 外部写回（他端变更、属性区写回）：基线整体替换。
   * - 本地改动（插入附件、源码变换）：基线沿用「保留原文」的结果，未触碰块继续保留原始字节。
   */
  loadMarkdown(markdown: string, options?: { keepBaseline?: boolean }): void {
    if (this.disposed || !this.editor) return;
    this.editor.action(replaceAll(markdown));
    this.canonicalText = markdown;
    if (options?.keepBaseline && this.guard) {
      const result = this.guard.update(markdown);
      this.preservedText = result.text;
    } else {
      this.guard?.reset(markdown);
      this.preservedText = markdown;
    }
  }

  getMarkdown(): string {
    if (!this.editor) return "";
    if (this.canonicalText) return this.canonicalText;
    return perfProbe.measure("editor.serialize", () => this.editor!.action(getMarkdown()));
  }

  /**
   * 应当持久化的文本（FR-EDT-8）：未触碰的块回填原文，避免版本历史出现纯格式噪声。
   * 编辑态仍是规范序列化文本，光标与选区逻辑不受影响。
   */
  getPreservedMarkdown(): string {
    if (this.preservedText !== null) return this.preservedText;
    if (!this.guard) return this.getMarkdown();
    const result = this.guard.update(this.getMarkdown());
    this.preservedText = result.text;
    return result.text;
  }

  /** 外部回声是否就是当前内容（避免把自己写的内容当成他端变更整篇重载）。 */
  isSameContent(markdown: string): boolean {
    if (markdown === this.canonicalText) return true;
    return this.preservedText !== null && markdown === this.preservedText;
  }

  /**
   * 表格单元格 DOM 元素 → 文档位置。
   * 用 `view.nodeDOM` 反查而不是 `posAtDOM`：后者依赖 DOM 与文档视图的内部对应关系，
   * 在自定义节点视图下不稳。逐个比对单元格渲染出的 DOM，命中即取位置。
   */
  private locateCell(cell: HTMLElement): { tablePos: number; cellPos: number } | null {
    if (!this.editor) return null;
    return this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const doc = view.state.doc;
      let found: { tablePos: number; cellPos: number } | null = null;
      doc.descendants((node, pos) => {
        if (found) return false;
        if (node.type.name !== "table") return true;
        let rowPos = pos + 1;
        node.forEach((row) => {
          if (found) return;
          let offset = 0;
          row.forEach((cellNode) => {
            if (found) return;
            const cellPos = rowPos + 1 + offset;
            offset += cellNode.nodeSize;
            if (view.nodeDOM(cellPos) === cell) found = { tablePos: pos, cellPos: cellPos + 1 };
          });
          rowPos += row.nodeSize;
        });
        return true;
      });
      return found;
    });
  }

  /** 表格上下文（行列与对齐），供表格块操作菜单显示当前状态（FR-EDT-9）。 */
  getTableContextAt(cell: HTMLElement): TableContext | null {
    const located = this.locateCell(cell);
    if (!located || !this.editor) return null;
    return this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      return locateTable(view.state.doc, located.cellPos)?.context ?? null;
    });
  }

  /** 对指定单元格所在表格执行命令（FR-EDT-9）。 */
  runTableCommand(command: TableCommandId, cell: HTMLElement): boolean {
    const located = this.locateCell(cell);
    if (!located || !this.editor) return false;
    return this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const tr = runTableCommandOn(view.state, command, located.cellPos);
      if (!tr) return false;
      view.dispatch(tr);
      view.focus();
      // 监听器的 markdownUpdated 有 200ms 防抖，这里同步把缓存刷新一次：
      // 否则在防抖窗口内保存会存到旧内容（表格结构刚变、内容却没变），
      // 外部回声判断也会拿旧内容去比对。
      this.canonicalText = ctx.get(serializerCtx)(view.state.doc);
      this.preservedText = null;
      return true;
    });
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

  /** 当前选区（含空选区的 storedMarks）生效的行内格式，供格式栏显示按下态。
   *  只看 markdown 偏移推断不出空选区的 storedMarks，按下 B 时按钮不会亮，看着像没生效。 */
  activeMarks(): InlineAction[] {
    if (!this.editor) return [];
    return this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { from, to, empty } = view.state.selection;
      const pairs: Array<[InlineAction, string]> = [
        ["bold", "strong"], ["italic", "emphasis"], ["strike", "strike_through"], ["code", "inlineCode"], ["link", "link"],
      ];
      return pairs
        .filter(([, name]) => {
          const mark = view.state.schema.marks[name];
          if (!mark) return false;
          if (!empty) return view.state.doc.rangeHasMark(from, to, mark);
          const marks = view.state.storedMarks ?? view.state.selection.$from.marks();
          return marks.some((item) => item.type === mark);
        })
        .map(([action]) => action);
    });
  }

  getSelection(): { start: number; end: number } {
    if (!this.editor) return { start: 0, end: 0 };
    return this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const serializer = ctx.get(serializerCtx);
      const doc = view.state.doc;
      const { from, to } = view.state.selection;
      let cached: { total: number; totalText: number } | null = null;
      const scale = () => {
        if (!cached) cached = { total: serializer(doc).length, totalText: doc.textBetween(0, doc.content.size, "\n", "\n").length };
        return cached;
      };
      const start = markdownPrefix(serializer, doc, from, scale);
      const end = from === to ? start : markdownPrefix(serializer, doc, to, scale);
      return { start, end };
    });
  }

  setSelection(start: number, end: number): void {
    if (!this.editor) return;
    this.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const serializer = ctx.get(serializerCtx);
      /** markdown 偏移 → ProseMirror 位置：定位到第一个覆盖该偏移的文本块，再按块内字符数近似取位。
       *  旧实现把匹配块一路覆盖到最后一个文本块，选区永远落在文末，setSelection 后页面直接滚到页尾。 */
      const doc = view.state.doc;
      let cached: { total: number; totalText: number } | null = null;
      const scale = () => {
        if (!cached) cached = { total: serializer(doc).length, totalText: doc.textBetween(0, doc.content.size, "\n", "\n").length };
        return cached;
      };
      const posFor = (offset: number) => {
        let found: number | null = null;
        doc.descendants((node, nodePos) => {
          if (found !== null) return false;
          if (!node.isTextblock) return true;
          const prefix = markdownPrefix(serializer, doc, nodePos, scale);
          const upto = markdownPrefix(serializer, doc, nodePos + node.nodeSize, scale);
          if (offset <= upto) {
            const within = Math.max(0, Math.min(node.content.size, offset - prefix));
            found = nodePos + 1 + within;
          }
          return false;
        });
        return Math.min(found ?? 1, doc.content.size);
      };
      const selection = (() => {
        try {
          return TextSelection.create(doc, posFor(start), posFor(end));
        } catch {
          // 目标位置落在表格这类非行内内容里，TextSelection 不接受——退回第一个段落开头。
          let safe = 1;
          doc.forEach((node, offset) => {
            if (safe === 1 && node.isTextblock && node.type.name === "paragraph") safe = offset + 1;
          });
          return TextSelection.create(doc, safe, safe);
        }
      })();
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
    this.detachKeyListener?.();
    this.detachKeyListener = null;
    if (this.editor) {
      await this.editor.destroy();
      this.editor = null;
    }
  }
}
