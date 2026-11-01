/** 主题模式（账户菜单·主题切换，负责人 2026-11-01）：system 跟随系统偏好，light/dark 强制覆盖。
 *  深色令牌由 :root[data-theme="dark"] 生效；首屏防闪烁的解析在 index.html 引导脚本，逻辑与此一致。 */

export type ThemeMode = "system" | "light" | "dark";

const STORAGE_KEY = "menote.theme";
const MODES: readonly ThemeMode[] = ["system", "light", "dark"];

let current: ThemeMode | null = null;
const listeners = new Set<() => void>();
const darkQuery = typeof window !== "undefined" && typeof window.matchMedia === "function"
  ? window.matchMedia("(prefers-color-scheme: dark)")
  : null;

function systemPrefersDark(): boolean {
  return darkQuery?.matches ?? false;
}

function readStored(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(raw as ThemeMode) ? (raw as ThemeMode) : "system";
  } catch {
    return "system";
  }
}

function apply(): void {
  if (typeof document === "undefined") return;
  const dark = current === "dark" || (current === "system" && systemPrefersDark());
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

darkQuery?.addEventListener("change", () => {
  if (current === "system") { apply(); notify(); }
});

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function getThemeMode(): ThemeMode {
  if (current === null) { current = readStored(); apply(); }
  return current;
}

export function setThemeMode(mode: ThemeMode): void {
  current = mode;
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* 存储不可用时本次会话内仍生效 */ }
  apply();
  notify();
}

export function subscribeTheme(listener: () => void): () => void {
  getThemeMode();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
