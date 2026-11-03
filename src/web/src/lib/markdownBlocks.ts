/**
 * 顶层块切分（FR-EDT-10 / TP4 · W3c 渐进渲染）。
 *
 * 预览渐进渲染要把长文档拆成若干块：先渲染可视区，其余在空闲时补齐。
 * 切分必须按 **顶层块**（mdast 的一级子节点）来，不能按空行硬切——
 * 松散列表内部的空行会把一个列表切成两个列表，渲染结果就变了。
 *
 * 纯函数模块：不依赖 DOM、不依赖 React，便于单测。
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

/** mdast 节点的最小结构视图。 */
interface MdNode {
  type: string;
  checked?: boolean | null;
  children?: MdNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

const processor = unified().use(remarkParse).use(remarkGfm);

/** 一个顶层块。 */
export interface BlockChunk {
  /** 块文本（含与下一块之间的空行，拼回去与原文逐字节一致）。 */
  text: string;
  /** 本块之前累计的任务列表项数量（预览态复选框的文档序序号要用）。 */
  taskBase: number;
}

/** 节点内的任务列表项数量（含嵌套）。 */
function countTasks(node: MdNode): number {
  let total = node.type === "listItem" && node.checked !== null && node.checked !== undefined ? 1 : 0;
  for (const child of node.children ?? []) total += countTasks(child);
  return total;
}

/**
 * 把 Markdown 拆成顶层块。
 *
 * 块文本包含它与下一块之间的空行，因此 `chunks.map(c => c.text).join("")`
 * 等于原文（去掉开头可能的空白）。空文档返回空数组。
 */
export function splitTopLevelBlocks(text: string): BlockChunk[] {
  const tree = processor.parse(text) as unknown as { children: MdNode[] };
  const children = tree.children;
  const chunks: BlockChunk[] = [];
  let taskBase = 0;
  for (let i = 0; i < children.length; i += 1) {
    const node = children[i]!;
    const start = node.position?.start?.offset;
    if (typeof start !== "number") continue;
    const nextStart = children[i + 1]?.position?.start?.offset;
    const end = typeof nextStart === "number" ? nextStart : text.length;
    chunks.push({ text: text.slice(start, end), taskBase });
    taskBase += countTasks(node);
  }
  return chunks;
}

/** 渐进渲染阈值（需求 §5.3(c)）。 */
export const PROGRESSIVE_CHARS = 20000;
export const PROGRESSIVE_BLOCKS = 3000;
/** 极端兜底：超过此字符数只渲染纯文本。 */
export const LIGHTWEIGHT_CHARS = 200000;
/** 首屏渲染的字符预算。 */
export const FIRST_BATCH_CHARS = 3000;
/** 每次空闲补齐的字符预算。 */
export const IDLE_BATCH_CHARS = 8000;

/** 该文档是否需要渐进渲染（分块 + 空闲补齐）。 */
export function needsProgressiveRender(text: string, blockCount: number): boolean {
  if (text.length > LIGHTWEIGHT_CHARS) return false;
  return text.length > PROGRESSIVE_CHARS || blockCount > PROGRESSIVE_BLOCKS;
}

/** 该文档是否切轻量模式（只渲染纯文本）。 */
export function needsLightweightMode(text: string): boolean {
  return text.length > LIGHTWEIGHT_CHARS;
}

/**
 * 从第 from 块起，按字符预算再取多少块。
 * 至少一块，保证有进展。
 */
export function batchCount(chunks: BlockChunk[], from: number, budget: number): number {
  let size = 0;
  let count = 0;
  for (let i = from; i < chunks.length; i += 1) {
    size += chunks[i]!.text.length;
    count += 1;
    if (size >= budget) break;
  }
  return Math.max(count, 1);
}
