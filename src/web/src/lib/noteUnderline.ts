import type { Processor } from "unified";

export type UnderlineStyle = "wavy" | "double";

interface MarkdownNode {
  type: string;
  value?: string;
  underlineStyle?: UnderlineStyle;
  children?: MarkdownNode[];
  data?: Record<string, unknown>;
}

const UNDERLINE_OPEN = /^<u\s+style=(["'])text-decoration-style:\s*(wavy|double);?\1\s*>$/i;
const U_OPEN = /^<u(?:\s|>)/i;
const U_CLOSE = /^<\/u\s*>$/i;

export function underlineStyle(value: unknown): UnderlineStyle | null {
  return value === "wavy" || value === "double" ? value : null;
}

function convertUnderlines(children: MarkdownNode[], preview: boolean): MarkdownNode[] {
  const stack: number[] = [];
  const endByStart = new Map<number, number>();
  children.forEach((child, index) => {
    if (child.type !== "html" || !child.value) return;
    if (U_OPEN.test(child.value)) stack.push(index);
    else if (U_CLOSE.test(child.value)) {
      const start = stack.pop();
      if (start !== undefined) endByStart.set(start, index);
    }
  });
  const result: MarkdownNode[] = [];
  for (let index = 0; index < children.length; index += 1) {
    const node = children[index]!;
    const end = endByStart.get(index);
    const style = node.type === "html" ? underlineStyle(node.value?.match(UNDERLINE_OPEN)?.[2]?.toLowerCase()) : null;
    if (style && end !== undefined) {
      const converted = convertUnderlines(children.slice(index + 1, end), preview);
      result.push({
        type: "noteUnderline",
        underlineStyle: style,
        children: converted,
        ...(preview ? { data: { hName: "u", hProperties: { className: [`mn-note-underline-${style}`] } } } : {}),
      });
      index = end;
    } else {
      result.push(node.children ? { ...node, children: convertUnderlines(node.children, preview) } : node);
    }
  }
  return result;
}

export function remarkNoteUnderline(this: Processor, options?: { preview?: boolean }) {
  const data = this.data();
  const extensions = data.toMarkdownExtensions ?? (data.toMarkdownExtensions = []);
  const extension = {
    handlers: {
      noteUnderline(node: MarkdownNode, _parent: unknown, state: { containerPhrasing: (node: MarkdownNode, info: unknown) => string }, info: unknown) {
        const style = underlineStyle(node.underlineStyle);
        const body = state.containerPhrasing(node, info);
        return style ? `<u style="text-decoration-style:${style}">${body}</u>` : body;
      },
    },
  };
  extensions.push(extension as unknown as (typeof extensions)[number]);
  return (tree: unknown) => {
    const root = tree as MarkdownNode;
    if (root.children) root.children = convertUnderlines(root.children, !!options?.preview);
  };
}
