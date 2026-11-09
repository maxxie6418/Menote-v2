const WIDTH_LEVELS = 8;

function storageKey(userId: string, itemId: string): string {
  return `menote:table-widths:${encodeURIComponent(userId)}:${encodeURIComponent(itemId)}`;
}

function hiddenColumnsStorageKey(userId: string, itemId: string): string {
  return `menote:table-hidden-columns:${encodeURIComponent(userId)}:${encodeURIComponent(itemId)}`;
}

function wrapColumnsStorageKey(userId: string, itemId: string): string {
  return `menote:table-wrap-columns:${encodeURIComponent(userId)}:${encodeURIComponent(itemId)}`;
}

/** Local-only table layout preference. It deliberately never enters IndexedDB content or sync. */
export function readTableColumnWidths(userId: string, itemId: string): number[] {
  try {
    const raw = localStorage.getItem(storageKey(userId, itemId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value) => Number.isInteger(value) ? Math.max(0, Math.min(WIDTH_LEVELS - 1, value as number)) : 0);
  } catch {
    return [];
  }
}

export function writeTableColumnWidths(userId: string, itemId: string, widths: number[]): void {
  try {
    localStorage.setItem(storageKey(userId, itemId), JSON.stringify(widths.map((value) => Math.max(0, Math.min(WIDTH_LEVELS - 1, value)))));
  } catch {
    // A blocked/full localStorage must not affect table editing or content persistence.
  }
}

/** Local cache for synced hidden-column preferences; never changes Markdown content. */
export function readHiddenTableColumns(userId: string, itemId: string): string[] {
  try {
    const raw = localStorage.getItem(hiddenColumnsStorageKey(userId, itemId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

export function writeHiddenTableColumns(userId: string, itemId: string, columns: string[]): void {
  try {
    localStorage.setItem(hiddenColumnsStorageKey(userId, itemId), JSON.stringify(columns));
  } catch {
    // A blocked/full localStorage must not affect table editing or content persistence.
  }
}

/** 列内容显示方式（裁切 / 自动换行）：按列名记录，只存本机，不进 Markdown 也不同步。
 *  按列名而非序号，列重排后仍然跟着同一列走；列改名会退回默认的裁切。 */
export function readTableWrapColumns(userId: string, itemId: string): string[] {
  try {
    const raw = localStorage.getItem(wrapColumnsStorageKey(userId, itemId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

export function writeTableWrapColumns(userId: string, itemId: string, columns: string[]): void {
  try {
    localStorage.setItem(wrapColumnsStorageKey(userId, itemId), JSON.stringify(columns));
  } catch {
    // A blocked/full localStorage must not affect table editing or content persistence.
  }
}
