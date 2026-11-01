/**
 * 格式栏与「/」菜单的文本变换（TP4）。只处理 Markdown 字符串与光标偏移，
 * 不依赖编辑器实现：WYSIWYG 与源码适配器都能用。
 * 偏移按 UTF-16 代码单元计，与 textarea.selectionStart 一致。
 */

export type InlineAction = "bold" | "italic" | "strike" | "code" | "link";

export type BlockAction =
  | "heading1" | "heading2" | "heading3"
  | "bullet" | "ordered" | "task" | "quote" | "codeblock" | "hr" | "table" | "image";

export interface EditResult {
  markdown: string;
  /** 变换后光标应落在这里；有选区时为选区开头。 */
  selectionStart: number;
  selectionEnd: number;
}

const INLINE_MARK: Record<Exclude<InlineAction, "link">, string> = {
  bold: "**",
  italic: "*",
  strike: "~~",
  code: "`",
};

/** 行内标记成对出现时返回 true。选区两端紧贴标记，或选区本身含标记，都算已应用。 */
function inlineWrapped(markdown: string, start: number, end: number, mark: string): { from: number; to: number } | null {
  const size = mark.length;
  if (start >= size && markdown.slice(start - size, start) === mark && markdown.slice(end, end + size) === mark) {
    return { from: start - size, to: end + size };
  }
  if (end - start >= size * 2 && markdown.slice(start, start + size) === mark && markdown.slice(end - size, end) === mark) {
    return { from: start, to: end };
  }
  return null;
}

/** 切换一个行内样式。无选区时插入一对空标记并把光标放在中间。 */
export function toggleInline(markdown: string, start: number, end: number, action: InlineAction): EditResult {
  const collapsed = start === end;
  if (action === "link") return toggleLink(markdown, start, end);
  const mark = INLINE_MARK[action];
  const wrapped = inlineWrapped(markdown, start, end, mark);
  if (wrapped) {
    const inner = markdown.slice(wrapped.from + mark.length, wrapped.to - mark.length);
    const next = markdown.slice(0, wrapped.from) + inner + markdown.slice(wrapped.to);
    const cursor = collapsed ? wrapped.from : wrapped.from;
    return { markdown: next, selectionStart: cursor, selectionEnd: cursor + inner.length };
  }
  const selected = markdown.slice(start, end);
  const inserted = `${mark}${selected}${mark}`;
  const next = markdown.slice(0, start) + inserted + markdown.slice(end);
  return collapsed
    ? { markdown: next, selectionStart: start + mark.length, selectionEnd: start + mark.length }
    : { markdown: next, selectionStart: start + mark.length, selectionEnd: start + mark.length + selected.length };
}

function toggleLink(markdown: string, start: number, end: number): EditResult {
  const collapsed = start === end;
  const link = /^\[([^\]]*)\]\([^)]*\)$/;
  const selected = markdown.slice(start, end);
  const around = markdown.slice(Math.max(0, start - 1), end + 1);
  if (!collapsed && link.test(selected)) {
    const text = selected.replace(link, "$1");
    return { markdown: markdown.slice(0, start) + text + markdown.slice(end), selectionStart: start, selectionEnd: start + text.length };
  }
  if (link.test(around)) {
    const text = around.replace(link, "$1");
    const from = start - 1;
    return { markdown: markdown.slice(0, from) + text + markdown.slice(end + 1), selectionStart: from, selectionEnd: from + text.length };
  }
  const label = collapsed ? "链接" : selected;
  const inserted = `[${label}]()`;
  const next = markdown.slice(0, start) + inserted + markdown.slice(end);
  const cursor = start + inserted.length - 1;
  return { markdown: next, selectionStart: cursor, selectionEnd: cursor };
}

const BLOCK_PREFIX: Partial<Record<BlockAction, string>> = {
  heading1: "# ",
  heading2: "## ",
  heading3: "### ",
  bullet: "- ",
  ordered: "1. ",
  task: "- [ ] ",
  quote: "> ",
};

/** 把光标所在行换成目标块；再点一次同一种前缀则去掉。代码块、分隔线、表格是插入，不切换。 */
export function applyBlock(markdown: string, cursor: number, action: BlockAction): EditResult {
  if (action === "codeblock") return insertAtLine(markdown, cursor, "```\n\n```", 4);
  if (action === "image") return { markdown, selectionStart: cursor, selectionEnd: cursor };
  if (action === "hr") return insertAtLine(markdown, cursor, "---", 3);
  if (action === "table") {
    const table = "| 列一 | 列二 | 列三 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n|  |  |  |";
    return insertAtLine(markdown, cursor, table, table.indexOf("列一"));
  }
  const prefix = BLOCK_PREFIX[action];
  if (!prefix) return { markdown, selectionStart: cursor, selectionEnd: cursor };
  const lineStart = markdown.lastIndexOf("\n", cursor - 1) + 1;
  const lineEnd = markdown.indexOf("\n", cursor);
  const end = lineEnd === -1 ? markdown.length : lineEnd;
  const line = markdown.slice(lineStart, end);
  const existing = matchBlockPrefix(line);
  const rest = existing ? line.slice(existing.length) : line;
  const nextLine = existing === prefix ? rest : prefix + rest;
  const next = markdown.slice(0, lineStart) + nextLine + markdown.slice(end);
  const caret = lineStart + nextLine.length;
  return { markdown: next, selectionStart: caret, selectionEnd: caret };
}

function matchBlockPrefix(line: string): string | null {
  const match = /^(?:#{1,6} |> |- \[[ x]\] |- |\d+\. )/.exec(line);
  return match ? match[0] : null;
}

/** 用一块内容替换光标所在行；光标落在块内 offset 处。 */
function insertAtLine(markdown: string, cursor: number, block: string, offsetInBlock: number): EditResult {
  const lineStart = markdown.lastIndexOf("\n", cursor - 1) + 1;
  const lineEnd = markdown.indexOf("\n", cursor);
  const end = lineEnd === -1 ? markdown.length : lineEnd;
  const next = markdown.slice(0, lineStart) + block + markdown.slice(end);
  const caret = lineStart + offsetInBlock;
  return { markdown: next, selectionStart: caret, selectionEnd: caret };
}

/** 附件引用插到光标处。图片用图片语法，其他文件用纯链接。 */
export function insertAttachment(markdown: string, cursor: number, file: { name: string; sha256: string }, asImage: boolean): EditResult {
  const ref = `attachments/${file.sha256}--${file.name}`;
  const snippet = asImage ? `![${file.name}](${ref})` : `[${file.name}](${ref})`;
  const needsBreak = cursor > 0 && markdown[cursor - 1] !== "\n";
  const inserted = `${needsBreak ? "\n\n" : ""}${snippet}\n`;
  const next = markdown.slice(0, cursor) + inserted + markdown.slice(cursor);
  const caret = cursor + inserted.length;
  return { markdown: next, selectionStart: caret, selectionEnd: caret };
}

export interface SlashMatch {
  /** 触发用的 `/` 在正文中的位置。 */
  from: number;
  /** 过滤词，不含 `/`。 */
  query: string;
}

/** 行首或空段落的 `/` 才触发；句子中间的斜杠不触发。 */
export function slashContext(markdown: string, cursor: number): SlashMatch | null {
  const lineStart = markdown.lastIndexOf("\n", cursor - 1) + 1;
  const before = markdown.slice(lineStart, cursor);
  const match = /^\/([^/\n]*)$/.exec(before);
  if (!match) return null;
  return { from: lineStart, query: match[1] ?? "" };
}

/** 去掉触发用的 `/过滤词`，再执行块级动作。 */
export function applySlash(markdown: string, slash: SlashMatch, cursor: number, action: BlockAction | InlineAction): EditResult {
  const stripped = markdown.slice(0, slash.from) + markdown.slice(cursor);
  if (isInline(action)) return toggleInline(stripped, slash.from, slash.from, action);
  return applyBlock(stripped, slash.from, action);
}

function isInline(action: BlockAction | InlineAction): action is InlineAction {
  return action === "bold" || action === "italic" || action === "strike" || action === "code" || action === "link";
}

/** 选区当前带哪些行内样式，供格式栏按下态。 */
export function activeInline(markdown: string, start: number, end: number): InlineAction[] {
  const active: InlineAction[] = [];
  for (const action of ["bold", "italic", "strike", "code"] as const) {
    if (inlineWrapped(markdown, start, end, INLINE_MARK[action])) active.push(action);
  }
  return active;
}
