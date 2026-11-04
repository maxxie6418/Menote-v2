/** Per-account view preferences for standalone table documents. */
export const TABLE_VIEW_SETTING_KEY = "tableViews";

export interface TableViewSettings {
  hiddenColumnsByItem: Record<string, string[]>;
}

export const DEFAULT_TABLE_VIEW_SETTINGS: Readonly<TableViewSettings> = { hiddenColumnsByItem: {} };

export function normalizeTableViewSettings(value: unknown): TableViewSettings {
  if (typeof value !== "object" || value === null) return { hiddenColumnsByItem: {} };
  const raw = (value as { hiddenColumnsByItem?: unknown }).hiddenColumnsByItem;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { hiddenColumnsByItem: {} };
  const entries = Object.entries(raw).slice(-2_000);
  const hiddenColumnsByItem: Record<string, string[]> = {};
  for (const [itemId, columns] of entries) {
    if (!itemId || itemId.length > 128 || !Array.isArray(columns)) continue;
    hiddenColumnsByItem[itemId] = [...new Set(columns.filter((column): column is string => typeof column === "string" && column.length > 0 && column.length <= 256))].slice(0, 256);
  }
  return { hiddenColumnsByItem };
}
