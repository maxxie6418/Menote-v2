/** 文档区布局偏好（设置·外观）。
 *
 *  1. 属性显示位置：top = 标题与正文之间（默认，项目现状）；side = 纸面右侧页边注。
 *  2. 编辑工具栏位置：auto = 跟随主题（柔纸模式浮动在底部，其余主题在顶部）；top / bottom 强制。
 *
 *  与 lib/fontPreference.ts 同模式：localStorage 持久化 + `<html data-props-pos>` / `<html data-toolbar>` 生效。
 *  工具栏写的是**解析后**的位置，样式只需读 `data-toolbar="bottom"`，不必在 CSS 里判断主题。
 *  首屏防闪烁解析在 main.tsx 与 index.html 引导脚本，逻辑与此一致。 */

import { getThemeSkin, subscribeSkin } from "./themeSkin";

export type PropsPlacement = "top" | "side";
export type ToolbarPlacement = "auto" | "top" | "bottom";
export type ResolvedToolbar = "top" | "bottom";

const PROPS_KEY = "menote.propsPos";
const TOOLBAR_KEY = "menote.toolbarPos";
const PROPS: readonly PropsPlacement[] = ["top", "side"];
const TOOLBARS: readonly ToolbarPlacement[] = ["auto", "top", "bottom"];

let props: PropsPlacement | null = null;
let toolbar: ToolbarPlacement | null = null;
const listeners = new Set<() => void>();

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return allowed.includes(raw as T) ? (raw as T) : fallback;
  } catch {
    return fallback;
  }
}

export function getPropsPlacement(): PropsPlacement {
  if (props === null) props = read(PROPS_KEY, PROPS, "top");
  return props;
}

export function getToolbarPlacement(): ToolbarPlacement {
  if (toolbar === null) toolbar = read(TOOLBAR_KEY, TOOLBARS, "auto");
  return toolbar;
}

/** auto 在柔纸模式下落到 bottom，其余主题维持顶栏（即项目现状）。 */
export function resolveToolbar(): ResolvedToolbar {
  const mode = getToolbarPlacement();
  if (mode !== "auto") return mode;
  return getThemeSkin() === "paper" ? "bottom" : "top";
}

function apply(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const nextProps = getPropsPlacement();
  if (nextProps === "top") delete root.dataset.propsPos;
  else root.dataset.propsPos = nextProps;
  root.dataset.toolbar = resolveToolbar();
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function applyDocLayout(): void {
  apply();
}

export function setPropsPlacement(value: PropsPlacement): void {
  props = value;
  try { localStorage.setItem(PROPS_KEY, value); } catch { /* 本次会话内仍生效 */ }
  apply();
  notify();
}

export function setToolbarPlacement(value: ToolbarPlacement): void {
  toolbar = value;
  try { localStorage.setItem(TOOLBAR_KEY, value); } catch { /* 本次会话内仍生效 */ }
  apply();
  notify();
}

export function subscribeDocLayout(listener: () => void): () => void {
  apply();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// 主题切换会改变 auto 的解析结果，订阅皮肤变化后重算属性。
subscribeSkin(() => {
  apply();
  notify();
});
