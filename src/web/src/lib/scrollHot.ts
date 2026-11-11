/** 滚动区指针热态（DESIGN §4.3）：让滚动条只在该区域被指向或正在滚动时浮现。
 *
 *  为什么不用 CSS：Chromium 不接受「容器 :hover 驱动 ::-webkit-scrollbar-*」这种
 *  组合（`*:hover::-webkit-scrollbar-thumb` 语法合法、`CSS.supports` 返回 true，
 *  但匹配不上，实测滑块颜色不变）；`::-webkit-scrollbar-thumb:hover` 只覆盖
 *  「指针精确压到 5px 滑块」这一种情形，等于要用户先猜位置。
 *
 *  做法：指针进入/离开时判断它落在哪个可滚动祖先上，给该元素打 `data-scroll-hot`，
 *  样式层凭这个属性把常态的极淡滑块换成可辨识的悬停色。滚动过程中同样打标记，
 *  停手 700ms 后收回——滚动时人需要知道自己在长文档的哪个位置。
 *
 *  事件只挂 pointerover / pointerout / scroll（capture），不监听 pointermove：
 *  跨元素边界才计算一次，静止移动不产生开销。粗指针（触屏）直接不安装，
 *  那边滚动条宽度本就为 0，交给系统。 */

const HOT_ATTR = "data-scroll-hot";
const SCROLL_HOLD_MS = 700;

let pointerHost: HTMLElement | null = null;
let scrollHost: HTMLElement | null = null;
let scrollTimer = 0;
let installed = false;

function isScrollable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.scrollHeight - el.clientHeight < 2 && el.scrollWidth - el.clientWidth < 2) return false;
  const { overflowX, overflowY } = getComputedStyle(el);
  return /(auto|scroll)/.test(overflowY) || /(auto|scroll)/.test(overflowX);
}

/** 从事件目标向上找最近的可滚动祖先；到根都没有就返回 null。 */
function findScroller(target: EventTarget | null): HTMLElement | null {
  let el: Element | null = target instanceof Element ? target : null;
  while (el && el !== document.documentElement) {
    if (isScrollable(el)) return el;
    el = el.parentElement;
  }
  return null;
}

/** 两个来源（指针、滚动）合并成同一个属性，避免互相清掉。 */
function syncAttr(el: HTMLElement | null): void {
  if (!el) return;
  el.toggleAttribute(HOT_ATTR, el === pointerHost || el === scrollHost);
}

function setPointerHost(next: HTMLElement | null): void {
  if (next === pointerHost) return;
  const prev = pointerHost;
  pointerHost = next;
  if (prev) syncAttr(prev);
  if (next) syncAttr(next);
}

function setScrollHost(next: HTMLElement | null): void {
  if (next === scrollHost) return;
  const prev = scrollHost;
  scrollHost = next;
  if (prev) syncAttr(prev);
  if (next) syncAttr(next);
}

function onPointerOver(event: PointerEvent): void {
  const target = event.target;
  // 在同一个滚动区内部移动时不必重算。
  if (pointerHost && target instanceof Node && pointerHost.contains(target)) return;
  setPointerHost(findScroller(target));
}

function onPointerOut(event: PointerEvent): void {
  const host = pointerHost;
  if (!host) return;
  const next = event.relatedTarget;
  if (next instanceof Node && host.contains(next)) return;
  setPointerHost(null);
}

function onScroll(event: Event): void {
  // scroll 事件只会由可滚动的滚动容器或文档发出，这里不再回读样式：
  // scroll 每帧触发，getComputedStyle + scrollHeight 会强制同步布局，滚长文档必卡。
  const host = event.target === document ? document.documentElement : event.target;
  if (!(host instanceof HTMLElement)) return;
  setScrollHost(host);
  window.clearTimeout(scrollTimer);
  scrollTimer = window.setTimeout(() => setScrollHost(null), SCROLL_HOLD_MS);
}

/** 首屏装配时调用一次（main.tsx）。重复调用无副作用。 */
export function installScrollHot(): void {
  if (installed || typeof window === "undefined" || typeof document === "undefined") return;
  installed = true;
  if (window.matchMedia?.("(pointer: coarse)").matches) return;
  document.addEventListener("pointerover", onPointerOver, { passive: true });
  document.addEventListener("pointerout", onPointerOut, { passive: true });
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
}
