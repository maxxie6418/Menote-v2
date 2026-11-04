import {
  DEFAULT_TABLE_VIEW_SETTINGS, TABLE_VIEW_SETTING_KEY, normalizeTableViewSettings,
  type TableViewSettings, type UserSetting,
} from "@menote/shared";
import { localDb } from "../db/localDb";
import { enqueueOutbox } from "../db/outboxRepo";
import { newId } from "../lib/hash";

export async function readHiddenColumnsSetting(userId: string, itemId: string): Promise<string[] | null> {
  const row = await localDb.settings.get([userId, TABLE_VIEW_SETTING_KEY]);
  if (row?.sensitivity !== "ordinary") return null;
  return normalizeTableViewSettings(row.value).hiddenColumnsByItem[itemId] ?? [];
}

export async function updateHiddenColumnsSetting(userId: string, itemId: string, columns: string[]): Promise<void> {
  await localDb.transaction("rw", localDb.settings, localDb.outbox, async () => {
    const current = await localDb.settings.get([userId, TABLE_VIEW_SETTING_KEY]);
    const queued = (await localDb.outbox.where("userId").equals(userId).toArray())
      .filter((row) => row.entity === "setting" && row.entityId === TABLE_VIEW_SETTING_KEY).sort((a, b) => a.seq! - b.seq!);
    const base = current?.sensitivity === "ordinary"
      ? normalizeTableViewSettings(current.value) : DEFAULT_TABLE_VIEW_SETTINGS as TableViewSettings;
    const hiddenColumnsByItem = { ...base.hiddenColumnsByItem };
    if (columns.length) hiddenColumnsByItem[itemId] = [...new Set(columns)];
    else delete hiddenColumnsByItem[itemId];
    const value = normalizeTableViewSettings({ hiddenColumnsByItem });
    const baseRev = queued[0]?.baseRev ?? current?.rev ?? 0;
    const setting: UserSetting = {
      userId, key: TABLE_VIEW_SETTING_KEY, sensitivity: "ordinary", value,
      rev: baseRev + 1, updatedAt: Date.now(),
    };
    await localDb.settings.put(setting);
    if (queued.length) await localDb.outbox.bulkDelete(queued.map((row) => row.seq!));
    await enqueueOutbox([{
      operationId: newId(), userId, entityId: TABLE_VIEW_SETTING_KEY, entity: "setting", action: "upsert",
      baseRev, baseMetaRev: 0, payload: { setting }, queuedAt: Date.now(), retries: 0, nextRetryAt: null, lastError: null,
    }]);
  });
  void import("./syncEngine").then(({ requestSync }) => requestSync(userId));
}

export async function applyPulledTableViewSettings(userId: string, settings: UserSetting[]): Promise<void> {
  const remote = settings.find((row) => row.key === TABLE_VIEW_SETTING_KEY && row.sensitivity === "ordinary");
  if (!remote || remote.sensitivity !== "ordinary") return;
  const pending = await localDb.outbox.where("userId").equals(userId)
    .and((row) => row.entity === "setting" && row.entityId === TABLE_VIEW_SETTING_KEY).count();
  if (pending > 0) return;
  await localDb.settings.put({ ...remote, value: normalizeTableViewSettings(remote.value) });
  if (typeof window !== "undefined") window.dispatchEvent(new Event("menote:table-view-settings"));
}
