/**
 * 往返保真校验（FR-EDT-8 / TP4 · W1）。
 *
 * 目标：所见即所得编辑时，用户**未触碰**的内容在序列化后与原文逐字节一致。
 *
 * 做法：以 **mdast 结构**为等价判据。Milkdown 的序列化器会做 8 类规范化改写
 * （列表符号、表格填充与分隔行宽度、setext→ATX、缩进代码块→围栏、硬换行风格、
 * 转义反斜杠等），这些差异在 mdast 上**不可见**，因此结构相同即可判定为「未变」。
 * 把新序列化结果与上一次可信文本逐块对齐，未变块回填原文，改动块用新文本。
 *
 * 切分粒度：顶层块；无序列表切到**列表项**、表格切到**行**（改一项不必重写整张列表）。
 * 有序列表保持整块——项序号是位置相关的，逐项回填会写错编号。
 *
 * 纯函数模块：不依赖 Milkdown、不碰 DOM，便于单测。
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

/** mdast 节点的最小结构视图（只取参与等价判定的字段）。 */
interface MdNode {
  type: string;
  value?: string;
  depth?: number;
  lang?: string | null;
  url?: string;
  title?: string | null;
  alt?: string | null;
  ordered?: boolean;
  start?: number | null;
  checked?: boolean | null;
  align?: Array<string | null> | null;
  identifier?: string;
  children?: MdNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

const processor = unified().use(remarkParse).use(remarkGfm);

/** 一段内容单元及其在原文中的位置。 */
export interface TextUnit {
  /** 在原文中的起始偏移。 */
  start: number;
  /** 在原文中的结束偏移（不含其后的空行）。 */
  end: number;
  /** 原文。 */
  raw: string;
  /** 结构键：等价判据。 */
  key: string;
}

/** 一次解析的结果。 */
export interface ParsedText {
  /** 整篇文本。 */
  text: string;
  /** 内容单元，按文档顺序。 */
  units: TextUnit[];
}

function childrenKey(node: MdNode): string {
  const children = node.children ?? [];
  return children.map((child) => canonicalKey(child)).join("|");
}

/**
 * 结构键：同键即视为语义等价。
 * 刻意**不**记录 position、spread、列表 start 等表现信息——它们正是序列化器会改写的地方。
 */
export function canonicalKey(node: MdNode): string {
  switch (node.type) {
    case "text": return `t(${node.value ?? ""})`;
    case "inlineCode": return `code(${node.value ?? ""})`;
    case "code": return `block(${node.lang ?? ""}|${node.value ?? ""})`;
    case "emphasis": return `em(${childrenKey(node)})`;
    case "strong": return `strong(${childrenKey(node)})`;
    case "delete": return `del(${childrenKey(node)})`;
    case "paragraph": return `p(${childrenKey(node)})`;
    case "heading": return `h${node.depth ?? 1}(${childrenKey(node)})`;
    case "blockquote": return `bq(${childrenKey(node)})`;
    case "list": return `list${node.ordered ? "o" : "u"}(${childrenKey(node)})`;
    case "listItem": {
      const checked = node.checked === null || node.checked === undefined ? "" : node.checked ? "1" : "0";
      return `li${checked}(${childrenKey(node)})`;
    }
    case "table": return `table(${(node.align ?? []).join(",")})(${childrenKey(node)})`;
    case "tableRow": return `tr(${childrenKey(node)})`;
    case "tableCell": return `td(${childrenKey(node)})`;
    case "thematicBreak": return "hr";
    case "break": return "br";
    case "html": return `html(${node.value ?? ""})`;
    case "link": return `link(${node.url ?? ""}|${node.title ?? ""})(${childrenKey(node)})`;
    case "image": return `image(${node.url ?? ""}|${node.alt ?? ""})`;
    case "definition": return `def(${node.identifier ?? ""}|${node.url ?? ""})`;
    case "footnoteDefinition": return `fdef(${node.identifier ?? ""})(${childrenKey(node)})`;
    case "footnoteReference": return `fref(${node.identifier ?? ""})`;
    case "yaml": return `yaml(${node.value ?? ""})`;
    default: return `${node.type}(${childrenKey(node)})`;
  }
}

function span(node: MdNode): { start: number; end: number } | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return null;
  return { start, end };
}

/**
 * 切分内容单元。
 * - 无序列表（多于一项）切到列表项：改一项不牵动整张列表。
 * - 表格切到行：表头与数据行分开比对；分隔行落在单元之间的空隙里。
 * - 有序列表保持整块：项序号随位置变化，逐项回填会写错编号。
 */
export function parseText(text: string): ParsedText {
  const tree = processor.parse(text) as unknown as { children: MdNode[] };
  const units: TextUnit[] = [];
  for (const node of tree.children) {
    const children = node.children ?? [];
    if (node.type === "list" && node.ordered === false && children.length > 1) {
      for (const item of children) {
        const range = span(item);
        if (!range) continue;
        units.push({ ...range, raw: text.slice(range.start, range.end), key: `ul:${canonicalKey(item)}` });
      }
      continue;
    }
    if (node.type === "table" && children.length > 1) {
      for (const row of children) {
        const range = span(row);
        if (!range) continue;
        units.push({ ...range, raw: text.slice(range.start, range.end), key: `tb:${canonicalKey(row)}` });
      }
      continue;
    }
    const range = span(node);
    if (!range) continue;
    units.push({ ...range, raw: text.slice(range.start, range.end), key: canonicalKey(node) });
  }
  return { text, units };
}

/** 单元 i 前面那段空白（可能含表格分隔行）文本；首个单元之前取文档开头。 */
function gapBefore(parsed: ParsedText, index: number): string {
  if (index <= 0) return parsed.text.slice(0, parsed.units[0]?.start ?? 0);
  const previous = parsed.units[index - 1]!;
  return parsed.text.slice(previous.end, parsed.units[index]!.start);
}

/** 空隙的「形状」：行数。形状不同说明结构变了，空隙必须用新文本的。 */
function gapShape(gap: string): number {
  return gap.split("\n").length;
}

/** 空隙里是否有非空白内容（表格分隔行这类结构行）。 */
function gapHasContent(gap: string): boolean {
  return /\S/.test(gap);
}

/**
 * 表格分隔行的对齐签名：`:---` 左对齐、`---:` 右对齐、`:---:` 居中、`---` 默认。
 * 不是分隔行返回 null。
 */
function delimiterAlign(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.includes("-")) return null;
  const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|");
  const marks: string[] = [];
  for (const cell of cells) {
    const text = cell.trim();
    if (!/^:?-+:?$/.test(text)) return null;
    const left = text.startsWith(":");
    const right = text.endsWith(":");
    if (left && right) marks.push("center");
    else if (left) marks.push("left");
    else if (right) marks.push("right");
    else marks.push("none");
  }
  return marks.join(",");
}

/**
 * 空隙的「签名」：含表格分隔行时取分隔行的**对齐**（分隔行落在表头行与首个数据行之间的空隙里，
 * 改列对齐只会改这一行；只看行数会把旧写法当成「未变」而丢掉新对齐）。
 * 不含分隔行时退回行数形状。
 */
function gapSignature(gap: string): string {
  for (const line of gap.split("\n")) {
    const align = delimiterAlign(line);
    if (align !== null) return `delim:${align}`;
  }
  return `shape:${gapShape(gap)}`;
}

/** 校验结果。 */
export interface GuardResult {
  /** 回填原文后的文本。 */
  text: string;
  /** 保留原文的单元数。 */
  preserved: number;
  /** 采用新文本的单元数。 */
  rewritten: number;
  /** 中段无法一一对应（结构变化较大）时为 true——此时中段整体采用新文本。 */
  misaligned: boolean;
}

/**
 * 把新序列化结果与上一次可信文本对齐，未变单元回填原文。
 *
 * 对齐策略：先取最长公共前缀与最长公共后缀，中段若长度一致则一一配对
 * （逐单元比结构键），否则中段整体采用新文本（保守，绝不产出错位内容）。
 *
 * 空隙（块间空白、表格分隔行）取原文还是新文本：
 * - 原文空隙只在「与前一个保留单元在原文中相邻」且「与新文本空隙形状一致」时采用；
 * - 否则用新文本的空隙，保证表格分隔行、列表间距等结构不会错位。
 */
export function preserveUnchanged(previous: ParsedText, next: string): GuardResult {
  const current = parseText(next);
  const prev = previous.units;
  const cur = current.units;

  let prefix = 0;
  while (prefix < prev.length && prefix < cur.length && prev[prefix]!.key === cur[prefix]!.key) prefix += 1;
  let suffix = 0;
  while (
    suffix < prev.length - prefix &&
    suffix < cur.length - prefix &&
    prev[prev.length - 1 - suffix]!.key === cur[cur.length - 1 - suffix]!.key
  ) suffix += 1;

  const prevMiddle = prev.slice(prefix, prev.length - suffix);
  const curMiddle = cur.slice(prefix, cur.length - suffix);
  const misaligned = prevMiddle.length !== curMiddle.length;

  // 逐单元决定用原文还是新文本。
  const picks: Array<{ raw: string; fromPrev: number | null }> = new Array(cur.length);
  for (let i = 0; i < prefix; i += 1) picks[i] = { raw: prev[i]!.raw, fromPrev: i };
  for (let i = cur.length - suffix; i < cur.length; i += 1) {
    const j = prev.length - (cur.length - i);
    picks[i] = { raw: prev[j]!.raw, fromPrev: j };
  }
  for (let i = prefix; i < cur.length - suffix; i += 1) {
    const middle = i - prefix;
    const candidate = misaligned ? undefined : prevMiddle[middle];
    if (candidate && candidate.key === cur[i]!.key) picks[i] = { raw: candidate.raw, fromPrev: prefix + middle };
    else picks[i] = { raw: cur[i]!.raw, fromPrev: null };
  }

  // 拼接：保留单元沿用原文（空隙需形状一致），改动单元用新文本。
  let preserved = 0;
  let rewritten = 0;
  let lastFromPrev = -1;
  const parts: string[] = [];
  for (let i = 0; i < cur.length; i += 1) {
    const pick = picks[i]!;
    const canonicalGap = i === 0 ? "" : gapBefore(current, i);
    let gap: string;
    if (pick.fromPrev !== null) {
      const j = pick.fromPrev;
      const originalGap = j === 0 ? gapBefore(previous, 0) : gapBefore(previous, j);
      const adjacent = j === lastFromPrev + 1;
      // 纯空白空隙：空行数量差异是表现层差异，可安全沿用原文；
      // 含结构行（表格分隔行）的空隙：只有签名一致才沿用原文，否则用新文本，避免分隔行错位。
      const bothBlank = !gapHasContent(originalGap) && !gapHasContent(canonicalGap);
      const sameShape = gapHasContent(originalGap) && gapHasContent(canonicalGap)
        && gapSignature(originalGap) === gapSignature(canonicalGap);
      gap = adjacent && (bothBlank || sameShape) ? originalGap : canonicalGap;
      preserved += 1;
    } else {
      gap = canonicalGap;
      rewritten += 1;
    }
    parts.push(gap, pick.raw);
    if (pick.fromPrev !== null) lastFromPrev = pick.fromPrev;
  }

  // 结尾：末尾单元未变且仍是原文最后一个单元时，沿用原文结尾空白。
  let tail = "";
  if (cur.length > 0) {
    const last = picks[cur.length - 1]!;
    if (last.fromPrev !== null && last.fromPrev === prev.length - 1) {
      tail = previous.text.slice(prev[prev.length - 1]!.end);
    } else {
      tail = current.text.slice(cur[cur.length - 1]!.end);
    }
  }

  return { text: parts.join("") + tail, preserved, rewritten, misaligned };
}

/**
 * 往返保真守卫：维护「上一次可信文本」，逐次把新的序列化结果回填成保留原文的版本。
 */
export class RoundTripGuard {
  private baseline: ParsedText;

  constructor(initial: string) {
    this.baseline = parseText(initial);
  }

  /** 外部写回或整体替换：基线直接换成新文本，不保留旧内容。 */
  reset(text: string): void {
    this.baseline = parseText(text);
  }

  /** 本地改动：基线沿用「保留原文」的结果，未触碰单元继续保留原始字节。 */
  update(text: string): GuardResult {
    const result = preserveUnchanged(this.baseline, text);
    this.baseline = parseText(result.text);
    return result;
  }

  /** 当前基线文本。 */
  get baselineText(): string {
    return this.baseline.text;
  }
}
