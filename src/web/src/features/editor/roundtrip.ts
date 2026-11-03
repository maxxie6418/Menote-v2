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

/**
 * 列表单元的种类：由结构键前缀判定。
 * 键是 mdast 结构的无损编码，因此前缀足以区分「列表项」「整条列表」与其他块。
 */
type ListUnitKind = "bullet-item" | "bullet-list" | "ordered-list" | "none";

function listUnitKind(key: string): ListUnitKind {
  if (key.startsWith("ul:")) return "bullet-item";
  if (key.startsWith("listu(")) return "bullet-list";
  if (key.startsWith("listo(")) return "ordered-list";
  return "none";
}

/** 取出结构键里「列表项」的键：去掉 `ul:` 前缀或 `listu(...)` / `listo(...)` 包装。 */
function listItemKey(key: string): string {
  if (key.startsWith("ul:")) return key.slice(3);
  return key.slice(key.indexOf("(") + 1, -1);
}

/** 无序列表符号（`-` / `*` / `+`）：不是列表项返回 null。 */
function bulletMarker(raw: string): string | null {
  const match = /^[ \t]{0,3}([-+*])(?:[ \t]+|$)/.exec(raw);
  return match ? match[1]! : null;
}

/** 有序列表分隔符（`.` / `)`）：不是有序列表返回 null。 */
function orderedDelimiter(raw: string): string | null {
  const match = /^[ \t]{0,3}\d{1,9}([.)])(?:[ \t]+|$)/.exec(raw);
  return match ? match[1]! : null;
}

/** 两块之间是否只有空白（没有别的块挡在中间）。 */
function gapIsBlank(text: string, from: number, to: number): boolean {
  return !gapHasContent(text.slice(from, to));
}

/**
 * 列表项前面的缩进。
 *
 * remark 的列表项起点在符号处，缩进不在块内而在**空隙**里，
 * 而缩进决定了一个列表项是不是上一项的子项——也就是列表怎么分组。
 * 空隙里没有换行时，整段空隙都是缩进。
 */
function itemIndent(text: string, unit: TextUnit, previousEnd: number): string {
  const gap = text.slice(previousEnd, unit.start);
  return gap.slice(gap.lastIndexOf("\n") + 1);
}

/**
 * 修正回填结果里的列表结构键。
 *
 * 回填本身可能改变列表的**分组**：旧原文写 `- 甲`、新文本写 `* 乙`，
 * 「- 甲」与「* 乙」在 Markdown 里是两个列表而不是一个。
 * 重新解析回填结果时这些块的结构键会从「列表项」变成「整条列表」，
 * 因此这里按回填结果里真实的分组修正键，保证 `units` 与重新解析完全等价。
 *
 * 只有列表会这样：其余块的结构由块自身的字节决定，
 * 而保留的字节与新文本的字节在结构上等价（对齐就是按键匹配的）。
 *
 * 返回 null 表示**无法在不解析的前提下还原分组**：列表项带了缩进，
 * 它可能是上一项的子项。这种情况退回整篇解析（罕见）。
 */
function fixListKeys(text: string, units: TextUnit[]): TextUnit[] | null {
  // 缩进决定列表项的归属，缩进不在块内（remark 的列表项起点在符号处），
  // 只有解析才知道它到底是不是子项——带缩进就老实解析一次。
  for (let i = 0; i < units.length; i += 1) {
    if (listUnitKind(units[i]!.key) === "none") continue;
    if (itemIndent(text, units[i]!, i === 0 ? 0 : units[i - 1]!.end) !== "") return null;
  }
  const fixed = units.map((unit) => ({ ...unit }));
  let i = 0;
  while (i < fixed.length) {
    const kind = listUnitKind(fixed[i]!.key);
    if (kind === "none") {
      i += 1;
      continue;
    }
    if (kind === "ordered-list") {
      // 有序列表保持整块：相邻两条分隔符相同的有序列表在回填结果里会并成一条，
      // 重新解析也是一条，因此这里把两条合成一个单元。
      const next = i + 1;
      const delimiter = orderedDelimiter(fixed[i]!.raw);
      if (
        delimiter !== null
        && next < fixed.length
        && listUnitKind(fixed[next]!.key) === "ordered-list"
        && gapIsBlank(text, fixed[next - 1]!.end, fixed[next]!.start)
        && orderedDelimiter(fixed[next]!.raw) === delimiter
      ) {
        fixed[i] = {
          start: fixed[i]!.start,
          end: fixed[next]!.end,
          raw: text.slice(fixed[i]!.start, fixed[next]!.end),
          key: `listo(${listItemKey(fixed[i]!.key)}|${listItemKey(fixed[next]!.key)})`,
        };
        fixed.splice(next, 1);
        continue;
      }
      i += 1;
      continue;
    }
    // 无序列表：按回填结果里真实的列表符号分组，符号不同即分属两条列表。
    const marker = bulletMarker(fixed[i]!.raw);
    const group: number[] = [];
    let j = i;
    while (j < fixed.length) {
      const itemKind = listUnitKind(fixed[j]!.key);
      if (itemKind !== "bullet-item" && itemKind !== "bullet-list") break;
      if (bulletMarker(fixed[j]!.raw) !== marker) break;
      if (j > i && !gapIsBlank(text, fixed[j - 1]!.end, fixed[j]!.start)) break;
      group.push(j);
      j += 1;
    }
    if (group.length === 0) {
      i += 1;
      continue;
    }
    // 两条以上同属一条列表 → 逐项成块；只有一条 → 整条列表成块。
    for (const index of group) {
      const itemKey = listItemKey(fixed[index]!.key);
      fixed[index] = {
        ...fixed[index]!,
        key: group.length >= 2 ? `ul:${itemKey}` : `listu(${itemKey})`,
      };
    }
    i = j;
  }
  return fixed;
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
  /**
   * 回填结果里的内容单元。
   *
   * 与「重新解析 `text`」得到的单元**完全等价**（块数、顺序、key、raw、start、end 一致），
   * 因此调用方可以拿它当新基线，不必再解析一次整篇——
   * 回填结果的块结构本来就是已知的：新文本的块，只有被保留的块换成了旧字节。
   */
  units: TextUnit[];
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
 *
 * 顺带产出回填结果的单元数组（`units`）：块结构在拼接时已经确定，
 * 不需要为了推进基线再解析一遍整篇；
 * 列表分组会被回填改变（旧符号与新符号混排），因此键由 fixListKeys 按回填结果修正，
 * 保证 `units` 与「重新解析回填结果」完全等价。
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
  let offset = 0;
  const parts: string[] = [];
  // 回填结果的单元：与重新解析回填结果等价，偏移顺次累加空隙与原文长度得到。
  const units: TextUnit[] = [];
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
    // 单元起点 = 上一个单元终点 + 本次空隙长度；终点 = 起点 + 写入字节长度。
    const start = offset + gap.length;
    const end = start + pick.raw.length;
    // 结构键先取当前文本的键：保留原文的单元其键与旧单元相同（对齐就是按键匹配的）。
    // 列表分组被回填改变时由 fixListKeys 修正。
    units.push({ start, end, raw: pick.raw, key: cur[i]!.key });
    offset = end;
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

  const text = parts.join("") + tail;
  // 列表分组可能被回填改变（旧符号与新符号混排），修正后与重新解析等价；
  // 修正不了（列表项带缩进）时退回整篇解析，保证结果永远与重新解析一致。
  const fixed = fixListKeys(text, units);
  return { text, preserved, rewritten, misaligned, units: fixed ?? parseText(text).units };
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
    // 基线直接用回填结果重建的单元推进：回填后的块结构本来就是已知的，
    // 再把整篇解析一遍只是白费一次 remark 解析（保存是热路径）。
    this.baseline = { text: result.text, units: result.units };
    return result;
  }

  /** 当前基线文本。 */
  get baselineText(): string {
    return this.baseline.text;
  }
}
