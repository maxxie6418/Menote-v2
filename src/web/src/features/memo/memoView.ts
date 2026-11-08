import type { Item } from "@menote/shared";

export type MemoRange = "all" | "today" | "7d" | "30d";

const DAY_MS = 86_400_000;
const STATUS_LABEL = { todo: "待办", doing: "进行中", done: "已完成" } as const;

/** 今天 0 点。筛选与分组都以此为界，避免各处各自取时间。 */
export function startOfToday(now = Date.now()): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function memoText(memo: Item): string {
  return memo.content.scope === "plain" ? memo.content.markdown : "";
}

/** 加密条目不展示正文（安全红线）；统计可以计数，热力图与标签不得带出明文。 */
export function isPlainMemo(memo: Item): boolean {
  return memo.content.scope === "plain";
}

export function inRange(createdAt: number, range: MemoRange, now = Date.now()): boolean {
  if (range === "all") return true;
  const start = startOfToday(now);
  if (range === "today") return createdAt >= start;
  const days = range === "7d" ? 7 : 30;
  return createdAt >= start - (days - 1) * DAY_MS;
}

export function filterMemos(memos: Item[], range: MemoRange, tag: string | null, now = Date.now()): Item[] {
  return memos.filter((memo) => {
    if (!inRange(memo.createdAt, range, now)) return false;
    if (tag && !memo.tags.includes(tag)) return false;
    return true;
  });
}

/** 今天 / 昨天 / 月日。同一天的条目必须已经按时间排好。 */
export function dayLabel(createdAt: number, now = Date.now()): string {
  const start = startOfToday(now);
  if (createdAt >= start) return "今天";
  if (createdAt >= start - DAY_MS) return "昨天";
  return new Date(createdAt).toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
}

export function groupByDay(memos: Item[], now = Date.now()): Array<{ label: string; memos: Item[] }> {
  const groups: Array<{ label: string; memos: Item[] }> = [];
  for (const memo of memos) {
    const label = dayLabel(memo.createdAt, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.memos.push(memo);
    else groups.push({ label, memos: [memo] });
  }
  return groups;
}

export function statusLabel(status: Item["status"]): string | null {
  return status ? STATUS_LABEL[status] : null;
}

export interface MemoStats {
  total: number;
  month: number;
  days: number;
}

export function memoStats(memos: Item[], now = Date.now()): MemoStats {
  const date = new Date(now);
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  const days = new Set<string>();
  let month = 0;
  for (const memo of memos) {
    days.add(new Date(memo.createdAt).toDateString());
    if (memo.createdAt >= monthStart) month += 1;
  }
  return { total: memos.length, month, days: days.size };
}

/** Month cells and current writing streak for the Memo workbar. */
export function memoCalendar(memos: Item[], now = Date.now()) {
  const today = new Date(now);
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const offset = start.getDay();
  const days = new Map<number, number>();
  for (const memo of memos) {
    const date = new Date(memo.createdAt);
    if (date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth()) {
      days.set(date.getDate(), (days.get(date.getDate()) ?? 0) + 1);
    }
  }
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const byDay = new Map<string, number>();
  for (const memo of memos) {
    const date = new Date(memo.createdAt);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  let streak = 0;
  const cursor = new Date(todayStart);
  const todayKey = `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`;
  if (!byDay.has(todayKey)) cursor.setDate(cursor.getDate() - 1);
  // 连续记录按 byDay 全量回溯，跨月不断档（1 号没写也能接上个月的连击）；366 天封顶。
  while (streak < 366) {
    const key = `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`;
    if (!byDay.has(key)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  const streakCells = Array.from({ length: 12 }, (_, index) => {
    const day = new Date(todayStart);
    day.setDate(day.getDate() - (11 - index));
    const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
    const count = byDay.get(key) ?? 0;
    return { day: day.getTime(), count, level: count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count <= 4 ? 3 : 4 };
  });
  const count = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  return { year: today.getFullYear(), month: today.getMonth(), offset, count, days, streak, streakCells };
}

export interface HeatCell {
  /** 当天 0 点，作格子的稳定键。 */
  day: number;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

/** 近 12 周 × 7 天，按周成列、周日起。不足的开头几天计数为 0。 */
export function heatGrid(memos: Item[], now = Date.now()): { cells: HeatCell[]; total: number } {
  const today = startOfToday(now);
  const weekday = new Date(today).getDay();
  const start = today - (11 * 7 + weekday) * DAY_MS;
  const counts = new Map<number, number>();
  let total = 0;
  for (const memo of memos) {
    const day = startOfToday(memo.createdAt);
    if (day < start || day > today) continue;
    counts.set(day, (counts.get(day) ?? 0) + 1);
    total += 1;
  }
  const cells: HeatCell[] = [];
  for (let cursor = start; cursor <= today; cursor += DAY_MS) {
    const count = counts.get(cursor) ?? 0;
    const level = count === 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 6 ? 3 : 4;
    cells.push({ day: cursor, count, level });
  }
  return { cells, total };
}

export function tagCounts(memos: Item[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const memo of memos) {
    if (!isPlainMemo(memo)) continue;
    for (const tag of memo.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

const IMAGE_REF = /!\[[^\]]*]\(attachments\/([0-9a-f]{64})--([^)\s]+)\)/g;

export interface MemoImage {
  memoId: string;
  sha256: string;
  createdAt: number;
  tag: string | null;
}

/** 图册只收明文 Memo 的图片引用。加密条目没有可展示的正文，整条排除。 */
export function memoImages(memos: Item[]): MemoImage[] {
  const images: MemoImage[] = [];
  for (const memo of memos) {
    if (!isPlainMemo(memo)) continue;
    for (const match of memoText(memo).matchAll(IMAGE_REF)) {
      images.push({ memoId: memo.id, sha256: match[1]!, createdAt: memo.createdAt, tag: memo.tags[0] ?? null });
    }
  }
  images.sort((a, b) => b.createdAt - a.createdAt);
  return images;
}

/** 往年同月同日的明文 Memo，不含今天。 */
export function onThisDay(memos: Item[], now = Date.now()): { when: string; memos: Item[] } | null {
  const today = new Date(now);
  const matched = memos.filter((memo) => {
    if (!isPlainMemo(memo)) return false;
    const date = new Date(memo.createdAt);
    return date.getMonth() === today.getMonth() && date.getDate() === today.getDate() && date.getFullYear() !== today.getFullYear();
  });
  if (matched.length === 0) return null;
  const earliest = matched.reduce((min, memo) => Math.min(min, memo.createdAt), matched[0]!.createdAt);
  return {
    when: new Date(earliest).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }),
    memos: matched,
  };
}

export function pickRandomMemo(memos: Item[]): Item | null {
  const plain = memos.filter(isPlainMemo);
  if (plain.length === 0) return null;
  return plain[Math.floor(Math.random() * plain.length)] ?? null;
}

/** 标题、表格、脚注不进渲染，原样留在正文里（FR-MEMO-2 / C-1）。 */
const RAW_LINE = /^(#{1,6}\s|(?:>\s*)?\|.+\||\[\^.+?\]:)/;

export function degradeMemoMarkdown(markdown: string): { markdown: string; raw: string[] } {
  const kept: string[] = [];
  const raw: string[] = [];
  let skippingTable = false;
  for (const line of markdown.split("\n")) {
    const table: boolean = /^(?:>\s*)?\|/.test(line.trim()) || (skippingTable && /^\s*[-:|\s]+$/.test(line));
    if (RAW_LINE.test(line.trim()) || table) {
      raw.push(line);
      skippingTable = table;
      continue;
    }
    skippingTable = false;
    kept.push(line.replace(/\[\^.+?\]/g, (mark) => {
      raw.push(mark);
      return "";
    }));
  }
  return { markdown: kept.join("\n"), raw };
}
