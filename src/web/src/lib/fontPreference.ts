/** 界面字体偏好（设置·外观）：noto = 自托管 Noto Sans SC（默认），system = 跟随系统字体栈。
 *  与 lib/theme.ts 同模式：localStorage 持久化 + <html data-font> 生效（tokens.css 按属性切栈）；
 *  首屏防闪烁解析在 index.html 引导脚本，逻辑与此一致。 */

export type FontPreference = "noto" | "system";

const STORAGE_KEY = "menote.font";
const MODES: readonly FontPreference[] = ["noto", "system"];

let current: FontPreference | null = null;

function readStored(): FontPreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(raw as FontPreference) ? (raw as FontPreference) : "noto";
  } catch {
    return "noto";
  }
}

function apply(): void {
  if (typeof document === "undefined") return;
  if (current === "system") document.documentElement.dataset.font = "system";
  else delete document.documentElement.dataset.font;
}

export function getFontPreference(): FontPreference {
  if (current === null) { current = readStored(); apply(); }
  return current;
}

export function setFontPreference(mode: FontPreference): void {
  current = mode;
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* 存储不可用时本次会话内仍生效 */ }
  apply();
}
