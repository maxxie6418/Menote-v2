/** 文档阅读宽度偏好（设置·外观）：auto 跟随主题默认；narrow = 42rem、
 *  wide = 56rem、full = 撑满文档栏。显式档位在所有主题中优先于主题默认值。
 *  与 lib/fontPreference.ts 同模式：localStorage 持久化 + `<html data-measure>` 生效
 *  （tokens.css 按属性切 --app-doc-measure）；首屏防闪烁解析在 index.html 引导脚本，逻辑与此一致。 */

export type MeasurePreference = "auto" | "narrow" | "wide" | "full";

const STORAGE_KEY = "menote.measure";
const MODES: readonly MeasurePreference[] = ["auto", "narrow", "wide", "full"];

let current: MeasurePreference | null = null;

function readStored(): MeasurePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(raw as MeasurePreference) ? (raw as MeasurePreference) : "auto";
  } catch {
    return "auto";
  }
}

function apply(): void {
  if (typeof document === "undefined") return;
  if (current === null || current === "auto") delete document.documentElement.dataset.measure;
  else document.documentElement.dataset.measure = current;
}

export function getMeasurePreference(): MeasurePreference {
  if (current === null) { current = readStored(); apply(); }
  return current;
}

export function setMeasurePreference(mode: MeasurePreference): void {
  current = mode;
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* 存储不可用时本次会话内仍生效 */ }
  apply();
}
