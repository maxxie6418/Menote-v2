import katex from "katex";
import remarkMath from "remark-math";
import { $inputRule, $markSchema, $nodeSchema, $remark } from "@milkdown/kit/utils";
import { InputRule } from "@milkdown/kit/prose/inputrules";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { Processor } from "unified";
import { obsidianHighlight, obsidianText, parseObsidianInline, remarkObsidianSyntax, type ObsidianAstNode } from "../../lib/obsidianMarkdown";

const INLINE_TYPES = new Set(["obsidianWikilink", "obsidianWikiEmbed", "obsidianBlockId", "obsidianComment", "obsidianInlineFootnote", "obsidianTag", "inlineMath"]);
const BLOCK_TYPES = new Set(["math", "obsidianBlockComment"]);

function obsidianEditorMarkdown(this: Processor) {
  const prepare = remarkObsidianSyntax.call(this);
  const data = this.data();
  const extensions = data.toMarkdownExtensions ?? (data.toMarkdownExtensions = []);
  const extension = { handlers: {
    obsidianLiteral: (node: ObsidianAstNode) => node.value ?? "",
    noteHighlightWritten(node: ObsidianAstNode & { marker?: string }, _parent: unknown,
      state: { containerPhrasing: (node: ObsidianAstNode, info: unknown) => string }, info: unknown) {
      return `==${node.marker ?? ""}${state.containerPhrasing(node, info)}==`;
    },
  } };
  extensions.push(extension as unknown as (typeof extensions)[number]);
  return (tree: unknown, file: { toString(): string }) => {
    prepare(tree, file);
    const source = file.toString();
    const annotate = (node: ObsidianAstNode): void => {
      if (INLINE_TYPES.has(node.type) || BLOCK_TYPES.has(node.type)) {
        node.raw = source.slice(node.position?.start.offset, node.position?.end.offset);
      }
      if (node.type === "obsidianHighlight") {
        const highlight = obsidianHighlight(node);
        node.children = highlight.content;
        node.data = { ...node.data, marker: highlight.marker, color: highlight.color };
      }
      node.children?.forEach(annotate);
    };
    annotate(tree as ObsidianAstNode);
  };
}

const obsidianRemark = $remark("obsidianMarkdown", () => obsidianEditorMarkdown);
const noteMathRemark = $remark("noteMath", () => remarkMath);

const obsidianHighlightMark = $markSchema("obsidianHighlight", () => ({
  attrs: { marker: { default: "" }, color: { default: null } },
  toDOM: (mark) => ["mark", { class: "mn-obsidian-highlight", "data-highlight-color": mark.attrs.color || undefined }, 0],
  parseDOM: [{ tag: "mark" }],
  parseMarkdown: {
    match: (node) => node.type === "obsidianHighlight",
    runner: (state, node, type) => {
      const data = node.data as Record<string, unknown> | undefined;
      state.openMark(type, { marker: data?.marker ?? "", color: data?.color ?? null });
      state.next(node.children);
      state.closeMark(type);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "obsidianHighlight",
    runner: (state, mark) => {
      const marker = typeof mark.attrs.marker === "string" ? mark.attrs.marker : "";
      state.withMark(mark, "noteHighlightWritten", undefined, { marker });
    },
  },
}));

function formulaElement(value: string, displayMode: boolean): HTMLElement {
  const element = document.createElement(displayMode ? "div" : "span");
  element.className = "mn-obsidian-formula";
  element.setAttribute("title", value);
  katex.render(value, element, { displayMode, throwOnError: false, trust: false, maxExpand: 500, maxSize: 25 });
  return element;
}

function obsidianLiteral(inline: boolean) {
  const types = inline ? INLINE_TYPES : BLOCK_TYPES;
  return $nodeSchema(inline ? "obsidianInline" : "obsidianBlock", () => ({
    group: inline ? "inline" : "block",
    inline,
    atom: true,
    attrs: { syntax: {}, raw: {}, label: { default: "" } },
    toDOM: (node) => {
      const { syntax, label } = node.attrs;
      if (syntax === "math" || syntax === "inlineMath") return formulaElement(label, !inline);
      return [inline ? "span" : "pre", {
        class: "mn-obsidian-source",
        "data-obsidian-syntax": syntax,
        title: node.attrs.raw,
      }, label];
    },
    parseMarkdown: {
      match: (node) => types.has(node.type),
      runner: (state, node, type) => {
        const ast = node as ObsidianAstNode;
        const raw = ast.raw ?? ast.value ?? "";
        const label = ast.type === "obsidianWikilink" ? obsidianText(ast) : ast.value ?? raw;
        state.addNode(type, { syntax: node.type, raw, label });
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === (inline ? "obsidianInline" : "obsidianBlock"),
      runner: (state, node) => { state.addNode("obsidianLiteral", undefined, node.attrs.raw); },
    },
  }));
}

const obsidianCallout = $nodeSchema("obsidianCallout", () => ({
  group: "block",
  content: "block+",
  defining: true,
  attrs: { kind: { default: "note" }, title: { default: "" }, fold: { default: undefined } },
  toDOM: (node) => ["aside", { class: "mn-obsidian-callout", "data-callout": node.attrs.kind },
    ["div", { class: "mn-obsidian-callout-title", contenteditable: "false" }, node.attrs.title || node.attrs.kind],
    ["div", { class: "mn-obsidian-callout-body" }, 0]],
  parseMarkdown: {
    match: (node) => node.type === "obsidianCallout",
    runner: (state, node, type) => {
      const ast = node as ObsidianAstNode;
      state.openNode(type, { kind: ast.kind, title: ast.title, fold: ast.fold });
      if (node.children?.length) state.next(node.children);
      else state.addNode(type.schema.nodes.paragraph!);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "obsidianCallout",
    runner: (state, node) => {
      state.openNode("obsidianCallout", undefined, node.attrs);
      state.next(node.content);
      state.closeNode();
    },
  },
}));

const highlightInput = $inputRule(() => new InputRule(/(?<![=\\])==([^=\n]+)==$/, (state, match, start, end) => {
  const type = state.schema.marks.obsidianHighlight;
  const value = match[1];
  if (!type || !value?.trim() || state.doc.resolve(start).marks().some((mark) => mark.type.spec.code)) return null;
  const transaction = state.tr.delete(end - 1, end).delete(start, start + 2);
  return transaction.addMark(start, start + value.length, type.create()).removeStoredMark(type);
}));

const obsidianInlineInput = $inputRule(() => new InputRule(
  /(?<![\\!\[\$%])(!?\[\[[^\]\n]+\]\]|%%[^%\n]+%%|\^\[[^\]\n]+\]|\$[^$\n]+\$)$/,
  (state, match, start, end) => {
    const source = match[0];
    if (state.doc.resolve(start).marks().some((mark) => mark.type.spec.code)) return null;
    const ast = parseObsidianInline(source);
    const type = state.schema.nodes.obsidianInline;
    if (!ast || !INLINE_TYPES.has(ast.type) || !type) return null;
    const label = ast.type === "obsidianWikilink" ? obsidianText(ast) : ast.value ?? source;
    return state.tr.replaceWith(start, end, type.create({ syntax: ast.type, raw: source, label }));
  },
));

export function finishObsidianBlock(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== "Enter" || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  const { state } = view;
  const { $from, empty } = state.selection;
  const paragraph = $from.parent;
  if (!empty || paragraph.type !== state.schema.nodes.paragraph || $from.parentOffset !== paragraph.content.size) return false;
  const containing = $from.depth >= 2 ? $from.node($from.depth - 1) : null;
  const header = /^\[!([a-z\d_-]+)\]([+-])?(?:[ \t]+(.*))?$/i.exec(paragraph.textContent);
  const callout = state.schema.nodes.obsidianCallout;
  if (header && callout && containing?.type === state.schema.nodes.blockquote && containing.firstChild === paragraph) {
    const [, kind, marker, title] = header;
    const fold = marker === "+" ? "open" : marker === "-" ? "closed" : undefined;
    const children = Array.from({ length: containing.childCount - 1 }, (_, index) => containing.child(index + 1));
    if (children.length === 0) children.push(paragraph.type.create());
    const start = $from.before($from.depth - 1);
    const transaction = state.tr.replaceWith(start, start + containing.nodeSize,
      callout.create({ kind: kind?.toLowerCase(), title, fold }, children));
    view.dispatch(transaction.setSelection(TextSelection.near(transaction.doc.resolve(start + 2))).scrollIntoView());
    return true;
  }
  const suffix = /(?:^|\s)(\^[\p{L}\p{N}_-]+)$/u.exec(paragraph.textBetween(0, paragraph.content.size, "", "\uFFFC"));
  const raw = suffix?.[1];
  const inline = state.schema.nodes.obsidianInline;
  if (raw && inline && !$from.marks().some((mark) => mark.type.spec.code)) {
    view.dispatch(state.tr.replaceWith($from.pos - raw.length, $from.pos,
      inline.create({ syntax: "obsidianBlockId", raw, label: raw })));
  }
  return false;
}

export const obsidianEditor = [
  ...obsidianRemark, ...noteMathRemark, ...obsidianHighlightMark,
  ...obsidianLiteral(true), ...obsidianLiteral(false), ...obsidianCallout, highlightInput, obsidianInlineInput,
];
