import { remarkObsidian, type ObsidianLinkTarget } from "@silicajs/remark-obsidian";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { unified, type Processor } from "unified";

export interface ObsidianAstNode {
  type: string;
  children?: ObsidianAstNode[];
  value?: string;
  id?: string;
  raw?: string;
  title?: string;
  kind?: string;
  fold?: string;
  depth?: number;
  target?: string;
  linkTarget?: ObsidianLinkTarget;
  embedSize?: { width: number; height?: number };
  identifier?: string;
  label?: string;
  data?: Record<string, unknown>;
  position?: { start: { offset?: number }; end: { offset?: number } };
}

const HIGHLIGHT_COLORS: Record<string, string> = {
  "🔴": "red", "🟠": "orange", "🟡": "yellow", "🟢": "green", "🔵": "blue", "🟣": "purple",
};

export function obsidianHighlight(node: ObsidianAstNode): { color?: string; marker?: string; content: ObsidianAstNode[] } {
  const content = node.children ?? [];
  const first = content[0];
  const marker = first?.type === "text" ? Array.from(first.value ?? "")[0] : undefined;
  const color = marker ? HIGHLIGHT_COLORS[marker] : undefined;
  if (!color || !marker || !first?.value) return { content };
  const value = first.value.slice(marker.length);
  return { color, marker, content: value ? [{ ...first, value }, ...content.slice(1)] : content.slice(1) };
}

export function remarkObsidianSyntax(this: Processor) {
  remarkObsidian.call(this, { inlineTags: false });
  const data = this.data();
  const extensions = data.toMarkdownExtensions ?? (data.toMarkdownExtensions = []);
  const extension = {
    handlers: {
      obsidianBlockComment: (node: ObsidianAstNode) => node.value ?? "",
    },
  };
  extensions.push(extension as unknown as (typeof extensions)[number]);
  // Inline comments already have tokenizer support. A comment spanning blank lines
  // is parsed as several blocks, so join those blocks with their original source.
  return (tree: unknown, file: { toString(): string }) => {
    const root = tree as ObsidianAstNode;
    const blocks = root.children;
    if (!blocks) return;
    const markdown = file.toString();
    const output: ObsidianAstNode[] = [];
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index]!;
      const start = block.position?.start.offset;
      if (block.type === "paragraph" && start !== undefined && markdown.startsWith("%%", start)) {
        const close = markdown.indexOf("%%", start + 2);
        if (close >= (block.position?.end.offset ?? Infinity)) {
          let last = index + 1;
          while (last < blocks.length && (blocks[last]!.position?.end.offset ?? Infinity) < close + 2) last += 1;
          const closingBlock = blocks[last];
          const end = closingBlock?.position?.end.offset ?? close + 2;
          if (closingBlock && !markdown.slice(close + 2, end).trim()) {
            output.push({
              type: "obsidianBlockComment", value: markdown.slice(start, end),
              position: { start: block.position!.start, end: closingBlock.position!.end },
            });
            index = last;
            continue;
          }
        }
      }
      output.push(block);
    }
    root.children = output;
  };
}

export function obsidianText(node: ObsidianAstNode): string {
  if (node.value !== undefined) return node.value;
  return node.children?.map(obsidianText).join("") ?? "";
}

export function normalizeObsidianName(value: string): string {
  return value.trim().normalize("NFC").toLowerCase();
}

export function obsidianAnchor(target: Pick<ObsidianLinkTarget, "heading" | "blockId">): string | undefined {
  if (target.blockId) return `obsidian-block-${normalizeObsidianName(target.blockId)}`;
  if (target.heading) return `obsidian-heading-${target.heading.split("#").map((part) => normalizeObsidianName(part).replace(/\s+/g, "-")).join("#")}`;
  return undefined;
}

function blockIdOf(node: ObsidianAstNode): string | undefined {
  return node.children?.find((child) => child.type === "obsidianBlockId")?.id;
}

const referenceParser = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(remarkObsidianSyntax);

export function parseObsidianInline(source: string): ObsidianAstNode | undefined {
  const root = referenceParser.runSync(referenceParser.parse(source), source) as ObsidianAstNode;
  const first = root.children?.[0];
  return first?.type === "paragraph" && first.children?.length === 1 ? first.children[0] : undefined;
}

/** Select exactly the first matching block or the matching heading and its descendants. */
export function obsidianExcerpt(markdown: string, target: Pick<ObsidianLinkTarget, "heading" | "blockId">): string | null {
  if (!target.heading && !target.blockId) return markdown;
  const tree = referenceParser.runSync(referenceParser.parse(markdown), markdown) as ObsidianAstNode;
  const blocks = tree.children ?? [];
  const ancestors: string[] = [];
  const headingPath = target.heading?.split("#").map(normalizeObsidianName) ?? [];
  const blockId = target.blockId && normalizeObsidianName(target.blockId);
  for (const [index, block] of blocks.entries()) {
    if (blockId) {
      const tagged = findObsidianBlock(block, blockId);
      if (!tagged) continue;
      const markerOnly = tagged === block && block.children?.every((child) =>
        child.type === "obsidianBlockId" || (child.type === "text" && !child.value?.trim()));
      return sliceNode(markdown, markerOnly ? blocks[index - 1] : tagged);
    }
    if (block.type !== "heading" || !block.depth) continue;
    ancestors.length = block.depth;
    ancestors[block.depth - 1] = normalizeObsidianName(obsidianText(block));
    if (ancestors.filter(Boolean).slice(-headingPath.length).join("#") !== headingPath.join("#")) continue;
    const next = blocks.slice(index + 1).find((node) => node.type === "heading" && (node.depth ?? 0) <= block.depth!);
    return markdown.slice(block.position?.start.offset ?? 0, next?.position?.start.offset ?? markdown.length);
  }
  return null;
}

function findObsidianBlock(node: ObsidianAstNode, blockId: string): ObsidianAstNode | undefined {
  if (normalizeObsidianName(blockIdOf(node) ?? "") === blockId) return node;
  for (const child of node.children ?? []) {
    const block = findObsidianBlock(child, blockId);
    if (block) return block;
  }
  return undefined;
}

function sliceNode(markdown: string, node?: ObsidianAstNode): string | null {
  return node?.position ? markdown.slice(node.position.start.offset, node.position.end.offset) : null;
}
