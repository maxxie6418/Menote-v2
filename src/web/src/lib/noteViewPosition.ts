import { splitFrontmatter } from "./frontmatter";
import { splitTopLevelBlocks } from "./markdownBlocks";

export interface NoteViewPosition {
  block: number | null;
  fraction: number;
  scrollTop: number;
  cursor?: { kind: "source" | "wysiwyg"; start: number; end: number; block: number | null };
}

const positions = new Map<string, NoteViewPosition>();
const STORAGE_PREFIX = "menote.note-position";
const RECENT_LIMIT = 80;

const natural = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const validBlock = (value: unknown) => value === null || natural(value);
const storedPosition = (value: unknown): value is NoteViewPosition => {
  if (typeof value !== "object" || value === null) return false;
  const { block, fraction, scrollTop, cursor } = value as NoteViewPosition;
  return validBlock(block) && Number.isFinite(fraction) && fraction >= 0 && fraction <= 1 &&
    Number.isFinite(scrollTop) && scrollTop >= 0 &&
    (cursor === undefined || (cursor !== null && (cursor.kind === "source" || cursor.kind === "wysiwyg") &&
      natural(cursor.start) && natural(cursor.end) && validBlock(cursor.block)));
};

export function notePositionKey(userId: string, noteId: string, sealed: boolean) {
  return `${STORAGE_PREFIX}:${JSON.stringify([userId, noteId, sealed])}`;
}

export function readNotePosition(key: string, sealed: boolean): NoteViewPosition | undefined {
  const memory = positions.get(key);
  if (memory || sealed) return memory;
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (storedPosition(value)) return value;
  } catch { /* 当前浏览器可能禁止会话存储。 */ }
  return undefined;
}

export function writeNotePosition(key: string, sealed: boolean, value: NoteViewPosition) {
  positions.delete(key);
  positions.set(key, value);
  if (positions.size > RECENT_LIMIT) {
    const oldest = positions.keys().next().value;
    if (oldest !== undefined) positions.delete(oldest);
  }
  if (sealed) return;
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* 内存位置仍可恢复。 */ }
}

/** 源码块起点保留完整文档坐标，属性区及不渲染的引用定义不占正文块位置。 */
export function sourceBlockOffsets(markdown: string, hasFrontmatter: boolean): number[] {
  const body = hasFrontmatter ? splitFrontmatter(markdown).body : markdown;
  const chunks = splitTopLevelBlocks(body);
  let start = markdown.length - chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  return chunks.flatMap(({ text }) => {
    const offset = start;
    start += text.length;
    return /^\[[^\]]+\]:[ \t]/.test(text) ? [] : [offset];
  });
}
