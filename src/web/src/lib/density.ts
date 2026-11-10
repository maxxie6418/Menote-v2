/** 界面密度偏好（设置·外观，2026-11-10）：
 *  全站尺寸以 rem 计（`--app-*` 令牌统一走 rem），所以根字号抬一档即整体等比放大 ——
 *  这正是"逐个令牌调 24/28"收不住的根本解：字号、间距、控件、图标一起走。
 *  与 lib/fontPreference.ts 同模式：localStorage 持久化 + `<html data-density>` 生效
 *  （tokens.css 按属性切 `:root` 的 font-size），并随账号外观设置同步。
 *
 *  `standard` 不写属性（等同 16px 基线），其余三档用百分比：尊重浏览器的默认字号偏好，
 *  用户若把浏览器基准调到 18px，紧凑档仍按比例缩放而不是写死 15px。 */

export type DensityPreference = "compact" | "standard" | "cozy" | "spacious";

const STORAGE_KEY = "menote.density";
const MODES: readonly DensityPreference[] = ["compact", "standard", "cozy", "spacious"];
/** 相对 16px 基线的比例；断点换算与测试断言都用它，避免两处各写一份数字。 */
const SCALES: Record<DensityPreference, number> = {
  compact: 15 / 16,
  standard: 1,
  cozy: 17 / 16,
  spacious: 18 / 16,
};

let current: DensityPreference | null = null;
const listeners = new Set<() => void>();

function readStored(): DensityPreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(raw as DensityPreference) ? (raw as DensityPreference) : "standard";
  } catch {
    return "standard";
  }
}

function apply(): void {
  if (typeof document === "undefined") return;
  if (current === null || current === "standard") delete document.documentElement.dataset.density;
  else document.documentElement.dataset.density = current;
}

export function getDensityPreference(): DensityPreference {
  if (current === null) { current = readStored(); apply(); }
  return current;
}

/** 当前密度相对 16px 基线的比例（断点换算用）。 */
export function getDensityScale(): number {
  return SCALES[getDensityPreference()];
}

export function setDensityPreference(mode: DensityPreference): void {
  if (current === mode) return;
  current = mode;
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* 存储不可用时本次会话内仍生效 */ }
  apply();
  listeners.forEach((listener) => listener());
}

export function subscribeDensity(listener: () => void): () => void {
  getDensityPreference();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
