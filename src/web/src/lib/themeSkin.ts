/** 界面皮肤：shadcn 为新账号默认；保留已选素灰和墨台。
 *  旧值 default → slate，paper → ink；存储不可用时使用新默认。 */

export type ThemeSkin = "shadcn" | "slate" | "ink";

const STORAGE_KEY = "menote.skin";
const SKINS: readonly ThemeSkin[] = ["shadcn", "slate", "ink"];
const DEFAULT_SKIN: ThemeSkin = "shadcn";

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
