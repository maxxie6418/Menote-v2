/** 界面皮肤（设置·外观）：slate = 素灰（默认），ink = 墨台。
 *  与 lib/theme.ts 同模式：localStorage 持久化 + `<html data-skin>` 生效。
 *  - slate 的令牌集中在 tokens.css 的 `:root[data-skin="slate"]`，结构覆盖在 styles/slate.css；
 *  - ink（墨台 v3）令牌即 tokens.css 的基础值，不写属性选择器也能成立。
 *  两种皮肤互相解耦：不切到某个皮肤时，它的规则一条都不命中。
 *
 *  历史值迁移：
 *  - 旧值 "default" 曾指墨台，素灰转正后统一按新默认（slate）解释——V2 尚无存量用户，
 *    不必保留墨台为隐式默认；想继续用墨台的人在设置里选一次「墨台」即可（值 "ink"）。
 *  - 旧值 "paper"（柔纸）已于 2026-11-11 与墨台合并：两者同属暖色纸质皮肤，
 *    合并后统一落到墨台（"ink"），柔纸的令牌块、paper.css 与形态覆盖一并下线。 */

export type ThemeSkin = "slate" | "ink";

const STORAGE_KEY = "menote.skin";
const SKINS: readonly ThemeSkin[] = ["slate", "ink"];
const DEFAULT_SKIN: ThemeSkin = "slate";

/** 兼容旧值：default → slate；paper → ink（并入墨台）；ink/slate 原样；其余回落默认。 */
function normalizeSkin(raw: string | null): ThemeSkin {
  if (raw === "default") return "slate";
  if (raw === "paper") return "ink";
  return SKINS.includes(raw as ThemeSkin) ? (raw as ThemeSkin) : DEFAULT_SKIN;
}

let current: ThemeSkin | null = null;

function readStored(): ThemeSkin {
  try {
    return normalizeSkin(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_SKIN;
  }
}

function apply(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.skin = current ?? DEFAULT_SKIN;
}

export function getThemeSkin(): ThemeSkin {
  if (current === null) { current = readStored(); apply(); }
  return current;
}

export function setThemeSkin(skin: ThemeSkin): void {
  current = normalizeSkin(skin);
  try { localStorage.setItem(STORAGE_KEY, current); } catch { /* 存储不可用时本次会话内仍生效 */ }
  apply();
}
