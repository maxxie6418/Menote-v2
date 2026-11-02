import type { UserSetting } from "@menote/shared";
import { localDb, getMeta, setMeta } from "../db/localDb";
import { enqueueOutbox } from "../db/outboxRepo";
import { newId } from "../lib/hash";
import { getThemeMode, setThemeMode, type ThemeMode } from "../lib/theme";
import { getFontPreference, setFontPreference, type FontPreference } from "../lib/fontPreference";
import { getMeasurePreference, setMeasurePreference, type MeasurePreference } from "../lib/measurePreference";
import { getDocStyle, setDocStyle, type DocStyleVars } from "../lib/docStyle";

export interface AppearanceSettings {
  theme: ThemeMode;
  font: FontPreference;
  measure: MeasurePreference;
  docStyle: DocStyleVars;
}

const SETTING_KEY = "appearance";
const LEGACY_IMPORTED_KEY = "appearanceLegacyImported";
const DEFAULT_APPEARANCE: AppearanceSettings = { theme: "system", font: "noto", measure: "narrow", docStyle: {} };

export function applyAppearance(value: AppearanceSettings): void {
  setThemeMode(value.theme);
  setFontPreference(value.font);
  setMeasurePreference(value.measure);
  setDocStyle(value.docStyle);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("menote:appearance"));
}

export async function saveAppearance(userId: string, value: AppearanceSettings): Promise<void> {
  let setting!: UserSetting;
  await localDb.transaction("rw", localDb.settings, localDb.outbox, async () => {
    const current = await localDb.settings.get([userId, SETTING_KEY]);
    const queued = (await localDb.outbox.where("userId").equals(userId).toArray())
      .filter((row) => row.entity === "setting" && row.entityId === SETTING_KEY).sort((a, b) => a.seq! - b.seq!);
    const baseRev = queued[0]?.baseRev ?? current?.rev ?? 0;
    const rev = baseRev + 1;
    setting = { userId, key: SETTING_KEY, sensitivity: "ordinary", value, rev, updatedAt: Date.now() };
    await localDb.settings.put(setting);
    if (queued.length) await localDb.outbox.bulkDelete(queued.map((row) => row.seq!));
    await enqueueOutbox([{
      operationId: newId(), userId, entityId: SETTING_KEY, entity: "setting", action: "upsert",
      baseRev, baseMetaRev: 0, payload: { setting }, queuedAt: Date.now(), retries: 0,
      nextRetryAt: null, lastError: null,
    }]);
  });
  applyAppearance(value);
  void import("./syncEngine").then(({ requestSync }) => requestSync(userId));
}

export async function applyPulledSettings(userId: string, settings: UserSetting[]): Promise<void> {
  const remote = settings.find((setting) => setting.key === SETTING_KEY && setting.sensitivity === "ordinary");
  const pending = await localDb.outbox.where("userId").equals(userId).and((row) => row.entity === "setting" && row.entityId === SETTING_KEY).count();
  if (remote?.sensitivity === "ordinary") {
    if (pending === 0) {
      await localDb.settings.put(remote);
      applyAppearance(remote.value as AppearanceSettings);
    }
    await setMeta(LEGACY_IMPORTED_KEY, true);
    return;
  }
  if (pending > 0) return;
  if (await getMeta<boolean>(LEGACY_IMPORTED_KEY)) {
    applyAppearance(DEFAULT_APPEARANCE);
    return;
  }

  // Import old browser-only preferences once, into the first account that signs in on this device.
  const legacy: AppearanceSettings = {
    theme: getThemeMode(), font: getFontPreference(), measure: getMeasurePreference(), docStyle: getDocStyle(),
  };
  await saveAppearance(userId, legacy);
  await setMeta(LEGACY_IMPORTED_KEY, true);
}

export async function updateAppearance(userId: string, patch: Partial<AppearanceSettings>): Promise<void> {
  const current = await localDb.settings.get([userId, SETTING_KEY]);
  const base: AppearanceSettings = current?.sensitivity === "ordinary"
    ? current.value as AppearanceSettings
    : { theme: getThemeMode(), font: getFontPreference(), measure: getMeasurePreference(), docStyle: getDocStyle() };
  await saveAppearance(userId, { ...base, ...patch, docStyle: patch.docStyle ?? base.docStyle });
}

/** 读取账号已同步的外观偏好（UI 只经服务访问数据层）；无记录或非普通敏感度返回 null。 */
export async function readAppearance(userId: string): Promise<AppearanceSettings | null> {
  const current = await localDb.settings.get([userId, SETTING_KEY]);
  if (current?.sensitivity !== "ordinary") return null;
  return current.value as AppearanceSettings;
}

