/** 界面皮肤（设置·外观）：default = 现有纸白主题，paper = 柔纸模式。
 *  与 lib/theme.ts 同模式：localStorage 持久化 + `<html data-skin>` 生效；
 *  paper 的令牌集中在 tokens.css 的 `:root[data-skin="paper"]`，结构覆盖在 styles/paper.css，
 *  与默认主题完全解耦——不切到 paper 时不会命中任何一条规则。 */

export type ThemeSkin = "default" | "paper";

const STORAGE_KEY = "menote.skin";
const SKINS: readonly ThemeSkin[] = ["default", "paper"];

let current: ThemeSkin | null = null;
const listeners = new Set<() => void>();

function readStored(): ThemeSkin {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return SKINS.includes(raw as ThemeSkin) ? (raw as ThemeSkin) : "default";
  } catch {
    return "default";
  }
}

function apply(): void {
  if (typeof document === "undefined") return;
  if (current === null || current === "default") delete document.documentElement.dataset.skin;
  else document.documentElement.dataset.skin = current;
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function getThemeSkin(): ThemeSkin {
  if (current === null) { current = readStored(); apply(); }
  return current;
}

export function setThemeSkin(skin: ThemeSkin): void {
  current = skin;
  try { localStorage.setItem(STORAGE_KEY, skin); } catch { /* 存储不可用时本次会话内仍生效 */ }
  apply();
  notify();
}

export function subscribeSkin(listener: () => void): () => void {
  getThemeSkin();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
