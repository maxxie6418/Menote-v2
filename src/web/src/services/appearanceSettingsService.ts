import type { UserSetting } from "@menote/shared";
import { localDb, getMeta, setMeta } from "../db/localDb";
import { enqueueOutbox } from "../db/outboxRepo";
import { newId } from "../lib/hash";
import { getThemeMode, setThemeMode, type ThemeMode } from "../lib/theme";
import { getFontPreference, setFontPreference, type FontPreference } from "../lib/fontPreference";
import { getDensityPreference, setDensityPreference, type DensityPreference } from "../lib/density";
import { getMeasurePreference, setMeasurePreference, type MeasurePreference } from "../lib/measurePreference";
import { getThemeSkin, setThemeSkin, type ThemeSkin } from "../lib/themeSkin";
import { getPropsPlacement, getToolbarPlacement, setPropsPlacement, setToolbarPlacement, type PropsPlacement, type ToolbarPlacement } from "../lib/docLayout";
import { getDocStyle, setDocStyle, type DocStyleVars } from "../lib/docStyle";

export interface AppearanceSettings {
  theme: ThemeMode;
  /** 皮肤：slate = 素灰（默认）、ink = 墨台、paper = 柔纸。 */
  skin: ThemeSkin;
  font: FontPreference;
  /** 界面密度：整站按根字号等比缩放（字号/间距/控件一起走），非逐项改尺寸。 */
  density: DensityPreference;
  measure: MeasurePreference;
  /** 属性显示位置：top = 标题与正文之间，side = 纸面右侧页边注。 */
  propsPos: PropsPlacement;
  /** 编辑工具栏位置：auto = 跟随主题，top / bottom 强制。 */
  toolbar: ToolbarPlacement;
  /** 主导航：bar=完整侧栏；rail=书脊 + 清单栏导航。 */
  railMode: "bar" | "rail";
  /** Memo 侧记栏位置；窄屏布局由响应式规则接管。 */
  memoWorkbarSide: "left" | "right";
  /** Memo 首次进入时 Todo 侧板状态。 */
  memoTodoDefault: "open" | "closed";
  docStyle: DocStyleVars;
}

const SETTING_KEY = "appearance";
const LEGACY_IMPORTED_KEY = "appearanceLegacyImported";
const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: "system", skin: "slate", font: "noto", density: "standard", measure: "auto",
  propsPos: "top", toolbar: "auto", railMode: "bar", memoWorkbarSide: "left", memoTodoDefault: "open", docStyle: {},
};

const DENSITY_MODES: readonly DensityPreference[] = ["compact", "standard", "cozy", "spacious"];
const SKIN_MODES: readonly ThemeSkin[] = ["slate", "ink", "paper"];

/** 旧同步值 "default" 曾指墨台；素灰转正后统一按新默认（slate）解释，
 *  想继续用墨台的人改用 "ink"（设置·外观 → 界面主题 → 墨台）。 */
function normalizeSkin(value: unknown): ThemeSkin {
  if (value === "ink" || value === "paper") return value;
  return SKIN_MODES.includes(value as ThemeSkin) ? (value as ThemeSkin) : "slate";
}

function normalizeAppearance(value: Partial<AppearanceSettings>): AppearanceSettings {
  return {
    ...DEFAULT_APPEARANCE,
    ...value,
    skin: normalizeSkin(value.skin),
    density: DENSITY_MODES.includes(value.density as DensityPreference) ? (value.density as DensityPreference) : "standard",
    railMode: value.railMode === "rail" ? "rail" : "bar",
    memoWorkbarSide: value.memoWorkbarSide === "right" ? "right" : "left",
    memoTodoDefault: value.memoTodoDefault === "closed" ? "closed" : "open",
    docStyle: value.docStyle ?? {},
  };
}

export function applyAppearance(value: AppearanceSettings): void {
  value = normalizeAppearance(value);
  setThemeMode(value.theme);
  // 皮肤先落定：工具栏的 auto 解析依赖当前皮肤。
  setThemeSkin(value.skin);
  setFontPreference(value.font);
  setDensityPreference(value.density);
  setMeasurePreference(value.measure);
  setPropsPlacement(value.propsPos ?? "top");
  setToolbarPlacement(value.toolbar ?? "auto");
  setDocStyle(value.docStyle);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.rail = value.railMode;
    document.documentElement.dataset.memoWorkbarSide = value.memoWorkbarSide;
    document.documentElement.dataset.memoTodoDefault = value.memoTodoDefault;
  }
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
      applyAppearance(normalizeAppearance(remote.value as Partial<AppearanceSettings>));
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
    theme: getThemeMode(), skin: getThemeSkin(), font: getFontPreference(), density: getDensityPreference(), measure: getMeasurePreference(),
    propsPos: getPropsPlacement(), toolbar: getToolbarPlacement(), railMode: "bar", memoWorkbarSide: "left", memoTodoDefault: "open", docStyle: getDocStyle(),
  };
  await saveAppearance(userId, legacy);
  await setMeta(LEGACY_IMPORTED_KEY, true);
}

export async function updateAppearance(userId: string, patch: Partial<AppearanceSettings>): Promise<void> {
  const current = await localDb.settings.get([userId, SETTING_KEY]);
  const base: AppearanceSettings = current?.sensitivity === "ordinary"
    ? normalizeAppearance(current.value as Partial<AppearanceSettings>)
    : {
        theme: getThemeMode(), skin: getThemeSkin(), font: getFontPreference(), density: getDensityPreference(), measure: getMeasurePreference(),
        propsPos: getPropsPlacement(), toolbar: getToolbarPlacement(), railMode: "bar", memoWorkbarSide: "left", memoTodoDefault: "open", docStyle: getDocStyle(),
      };
  await saveAppearance(userId, normalizeAppearance({ ...base, ...patch, docStyle: patch.docStyle ?? base.docStyle }));
}

/** 读取账号已同步的外观偏好（UI 只经服务访问数据层）；无记录或非普通敏感度返回 null。 */
export async function readAppearance(userId: string): Promise<AppearanceSettings | null> {
  const current = await localDb.settings.get([userId, SETTING_KEY]);
  if (current?.sensitivity !== "ordinary") return null;
  return normalizeAppearance(current.value as Partial<AppearanceSettings>);
}

