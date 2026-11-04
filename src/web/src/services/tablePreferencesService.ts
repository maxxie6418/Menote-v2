const WIDTH_LEVELS = 8;

function storageKey(userId: string, itemId: string): string {
  return `menote:table-widths:${encodeURIComponent(userId)}:${encodeURIComponent(itemId)}`;
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
