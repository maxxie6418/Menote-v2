import { DEFAULT_MONITOR_PREFERENCES, type MonitorPreferences } from "@menote/shared";
import { readPreferences, writePreferences } from "../db/monitor-preferences";

export function validPreferences(value: unknown): value is MonitorPreferences {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<MonitorPreferences>;
  return Number.isSafeInteger(v.dailyQuota) && v.dailyQuota! > 0 &&
    Number.isInteger(v.reminder) && Number.isInteger(v.warning) && Number.isInteger(v.critical) &&
    v.reminder! > 0 && v.reminder! < v.warning! && v.warning! < v.critical! && v.critical! <= 100 &&
    Number.isInteger(v.refreshIntervalMinutes) && [5, 15, 30, 60].includes(v.refreshIntervalMinutes!);
}

export async function loadMonitorPreferences(): Promise<MonitorPreferences> {
  const stored = await readPreferences();
  if (typeof stored === "object" && stored !== null) {
    const migrated = { ...DEFAULT_MONITOR_PREFERENCES, ...stored };
    if (validPreferences(migrated)) return migrated;
  }
  return { ...DEFAULT_MONITOR_PREFERENCES };
}

export async function saveMonitorPreferences(value: MonitorPreferences): Promise<void> {
  if (!validPreferences(value)) throw new Error("Invalid monitor preferences");
  await writePreferences(value);
}
