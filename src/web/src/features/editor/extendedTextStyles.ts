import { Plugin, type EditorState, type Transaction } from "@milkdown/kit/prose/state";
import { $markSchema, $prose, $remark } from "@milkdown/kit/utils";
import type { MarkType } from "@milkdown/kit/prose/model";
import type { EditorView } from "@milkdown/kit/prose/view";
import { remarkNoteUnderline, underlineStyle } from "../../lib/noteUnderline";

export const NOTE_TEXT_STYLES = [
  { id: "wavy", label: "波浪下划线", shortcut: "--" },
  { id: "double", label: "双下划线", shortcut: "==" },
  { id: "highlight", label: "高亮", shortcut: null },
] as const;

export type NoteTextStyle = typeof NOTE_TEXT_STYLES[number]["id"];

export const noteUnderlineRemark = $remark("noteUnderline", () => remarkNoteUnderline);

export const noteUnderlineMark = $markSchema("noteUnderline", () => ({
  attrs: { style: { default: "wavy" } },
  toDOM: (mark) => ["u", { class: `mn-note-underline-${mark.attrs.style}` }, 0],
  parseDOM: [{
    tag: "u",
    getAttrs: (node) => {
      const style = underlineStyle(node.style.textDecorationStyle)
        ?? underlineStyle([...node.classList].find((name) => name.startsWith("mn-note-underline-"))?.slice("mn-note-underline-".length));
      return style ? { style } : false;
    },
  }],
  parseMarkdown: {
    match: (node) => node.type === "noteUnderline",
    runner: (state, node, type) => {
      const style = underlineStyle(node.underlineStyle);
      if (!style) { state.next(node.children); return; }
      state.openMark(type, { style });
      state.next(node.children);
      state.closeMark(type);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "noteUnderline",
    runner: (state, mark) => { state.withMark(mark, "noteUnderline", undefined, { underlineStyle: mark.attrs.style }); },
  },
}));

function markFor(state: EditorState, style: NoteTextStyle): MarkType | undefined {
  return state.schema.marks[style === "highlight" ? "obsidianHighlight" : "noteUnderline"];
}

export function hasNoteTextStyle(state: EditorState, style: NoteTextStyle): boolean {
  const type = markFor(state, style);
  if (!type) return false;
  const matches = (mark: ReturnType<MarkType["create"]>) => mark.type === type
    && (style === "highlight" || mark.attrs.style === style);
  const selection = state.selection;
  if (selection.empty) return (state.storedMarks ?? selection.$from.marks()).some(matches);
  let active = false;
  state.doc.nodesBetween(selection.from, selection.to, (node) => {
    if (node.isInline && node.marks.some(matches)) active = true;
    return !active;
  });
  return active;
}

export function toggleNoteTextStyle(state: EditorState, style: NoteTextStyle, transaction: Transaction = state.tr): Transaction {
  const type = markFor(state, style);
  if (!type) return transaction;
  const mark = type.create(style === "highlight" ? undefined : { style });
  const active = hasNoteTextStyle(state, style);
  const { from, to, empty } = transaction.selection;
  if (empty) {
    const savedMarks = state.storedMarks ?? state.selection.$from.marks();
    return transaction.setStoredMarks(active ? mark.removeFromSet(savedMarks) : mark.addToSet(savedMarks));
  }
  return active ? transaction.removeMark(from, to, mark) : transaction.addMark(from, to, mark);
}

function applyUnderlineShortcut(view: EditorView, from: number, to: number): boolean {
  if (from !== to) return false;
  const { state } = view;
  const caret = state.doc.resolve(from);
  if (caret.parent.type.spec.code || (state.storedMarks ?? caret.marks()).some((mark) => mark.type.spec.code)) return false;
  const prefix = caret.parent.textBetween(Math.max(0, caret.parentOffset - 3), caret.parentOffset, "", "\uFFFC");
  const format = NOTE_TEXT_STYLES.find(({ shortcut }) => shortcut
    && (prefix === shortcut || (prefix.endsWith(shortcut) && /\s/.test(prefix[0] ?? ""))));
  if (!format?.shortcut) return false;
  const transaction = state.tr.delete(from - format.shortcut.length, to);
  view.dispatch(toggleNoteTextStyle(state, format.id, transaction));
  return true;
}

export const noteUnderlineInput = $prose(() => new Plugin({
  props: {
    handleKeyDown(view, event) {
      if (event.key !== " " || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
      const { from, to } = view.state.selection;
      return applyUnderlineShortcut(view, from, to);
    },
    handleTextInput(view, from, to, text) {
      return (text === " " || text === "\u00A0") && applyUnderlineShortcut(view, from, to);
    },
  },
}));
