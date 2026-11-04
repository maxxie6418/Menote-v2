import { $markSchema, $remark } from "@milkdown/kit/utils";

type MarkdownNode = {
  type: string;
  value?: string;
  color?: string;
  children?: MarkdownNode[];
  data?: Record<string, unknown>;
};

const ALLOWED_COLORS = new Set([
  "#c2412d", "#b45309", "#8a6d00", "#287044", "#2459a6", "#7046a6", "#6c6f6b",
]);
const OPEN_COLOR = /^<span\s+style=["']color:\s*(#[0-9a-f]{6});?["']\s*>$/i;
const CLOSE_COLOR = /^<\/span\s*>$/i;

function convertColorSpans(nodes: MarkdownNode[], destination: "bridge" | "html" | "render"): MarkdownNode[] {
  const output: MarkdownNode[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    const open = node.type === "html" ? node.value?.match(OPEN_COLOR) : null;
    const color = open?.[1]?.toLowerCase();
    if (color && ALLOWED_COLORS.has(color)) {
      let depth = 1;
      let closeAt = index + 1;
      for (; closeAt < nodes.length; closeAt += 1) {
        const candidate = nodes[closeAt]!;
        if (candidate.type !== "html" || !candidate.value) continue;
        if (OPEN_COLOR.test(candidate.value)) depth += 1;
        else if (CLOSE_COLOR.test(candidate.value) && --depth === 0) break;
      }
      if (closeAt < nodes.length) {
        const children = convertColorSpans(nodes.slice(index + 1, closeAt), destination);
        if (destination === "html") {
          output.push({ type: "html", value: `<span style="color:${color}">` }, ...children, { type: "html", value: "</span>" });
        } else if (destination === "render") {
          output.push({ type: "emphasis", children, data: { hName: "span", hProperties: { style: { color } } } });
        } else {
          output.push({ type: "textColor", color, children });
        }
        index = closeAt;
        continue;
      }
    }
    if (destination === "bridge" && node.type === "textColor" && node.color && node.children) {
      const color = node.color.toLowerCase();
      if (ALLOWED_COLORS.has(color)) output.push({ type: "html", value: `<span style="color:${color}">` }, ...convertColorSpans(node.children, destination), { type: "html", value: "</span>" });
      else output.push(...node.children);
    } else output.push(node.children ? { ...node, children: convertColorSpans(node.children, destination) } : node);
  }
  return output;
}

/** Milkdown bridge: raw HTML spans ↔ a ProseMirror text mark ↔ standard Markdown inline HTML. */
export const textColorRemark = $remark("menoteTextColor", () => () => (tree) => {
  const root = tree as unknown as MarkdownNode;
  if (root.children) root.children = convertColorSpans(root.children, "bridge");
  return tree;
});

export const textColorMark = $markSchema("menoteTextColor", () => ({
  attrs: { color: { default: "#2459a6" } },
  inclusive: false,
  parseDOM: [{
    tag: "span[style]",
    getAttrs: (dom) => {
      const color = (dom as HTMLElement).style.color.toLowerCase();
      const normalized = color.startsWith("#") ? color : null;
      return normalized && ALLOWED_COLORS.has(normalized) ? { color: normalized } : false;
    },
  }],
  toDOM: (mark) => ["span", { style: `color:${mark.attrs.color}` }, 0],
  parseMarkdown: {
    match: (node) => node.type === "textColor",
    runner: (state, node, markType) => {
      const color = typeof node.color === "string" && ALLOWED_COLORS.has(node.color.toLowerCase()) ? node.color.toLowerCase() : "#2459a6";
      state.openMark(markType, { color });
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "menoteTextColor",
    runner: (state, mark) => { state.withMark(mark, "textColor", undefined, { color: mark.attrs.color }); },
  },
}));

/** ReactMarkdown bridge: render only our allow-listed spans; arbitrary raw HTML stays inert. */
export function remarkTextColorForRender() {
  return (tree: { children?: unknown[] }) => {
    const root = tree as unknown as MarkdownNode;
    if (root.children) root.children = convertColorSpans(root.children, "render");
  };
}

export function isAllowedTextColor(color: string): boolean {
  return ALLOWED_COLORS.has(color.toLowerCase());
}
