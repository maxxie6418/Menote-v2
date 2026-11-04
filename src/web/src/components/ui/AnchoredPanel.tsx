import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface AnchoredPanelProps {
  anchor: HTMLElement;
  label: string;
  /** 内容高度变化时重算位置（类型切换、候选值、错误文案）。 */
  layoutKey?: string;
  /** 面板上的类名由调用方给：表格列菜单与属性浮层是两套外观。 */
  className?: string;
  /** 与锚点左对齐还是右对齐（属性浮层贴右，避免超出文档栏）。 */
  align?: "left" | "right";
  onClose: () => void;
  children: ReactNode;
}

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 4;

/** 找到最近的纵向滚动容器：锚点滚出可视区时面板要跟着藏起来。 */
function scrollParentOf(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node && node !== document.body) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

/** 挂到 document.body 的锚定浮层。容器是 overflow:auto 时，浮层留在里面会被裁成一条缝。 */
export function AnchoredPanel({ anchor, label, layoutKey, className = "mn-anchored-panel", align = "left", onClose, children }: AnchoredPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const place = () => {
      if (!anchor.isConnected) {
        panel.style.visibility = "hidden";
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const scrollParent = scrollParentOf(anchor);
      let inView = true;
      if (scrollParent) {
        const view = scrollParent.getBoundingClientRect();
        inView = rect.bottom > view.top && rect.top < view.bottom && rect.right > view.left && rect.left < view.right;
      }
      if (!inView) {
        panel.style.visibility = "hidden";
        return;
      }
      panel.style.visibility = "hidden";
      panel.style.maxHeight = "";
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      let left = align === "right" ? rect.right - width : rect.left;
      if (left + width > window.innerWidth - VIEWPORT_MARGIN) {
        left = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
      }
      if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;
      let top = rect.bottom + ANCHOR_GAP;
      if (height > window.innerHeight - VIEWPORT_MARGIN - top) {
        const above = rect.top - ANCHOR_GAP - height;
        if (above >= VIEWPORT_MARGIN) top = above;
        else {
          top = VIEWPORT_MARGIN;
          panel.style.maxHeight = `${Math.max(0, window.innerHeight - VIEWPORT_MARGIN * 2)}px`;
        }
      }
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.visibility = "visible";
    };
    place();
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && panel.contains(event.target)) return;
      place();
    };
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor, layoutKey, align]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (anchor.contains(target)) return;
      // 触发按钮自己会 toggle；这里若先关掉，紧接着的 click 会把它重新打开。
      if (target instanceof Element && target.closest("[data-panel-trigger]")) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={panelRef}
      className={className}
      role="dialog"
      aria-label={label}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
