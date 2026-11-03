import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface AnchoredPanelProps {
  anchor: HTMLElement;
  label: string;
  /** 内容高度变化时重算位置（类型切换、候选值、错误文案）。 */
  layoutKey?: string;
  onClose: () => void;
  children: ReactNode;
}

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 4;

/** 挂到 document.body 的列菜单。表格滚动容器是 overflow:auto，浮层留在里面会被裁成一条缝。 */
export function AnchoredPanel({ anchor, label, layoutKey, onClose, children }: AnchoredPanelProps) {
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
      const scrollParent = anchor.closest(".mn-tabledoc-scroll");
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
      let left = rect.left;
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
  }, [anchor, layoutKey]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target)) return;
      if (anchor.contains(target)) return;
      // 工具条/脚手架的「添加字段」自己会 toggle；这里若先关掉，紧接着的 click 会把它重新打开。
      if (target instanceof Element && target.closest("[data-table-add-trigger]")) return;
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
      className="mn-tabledoc-hmenu"
      role="dialog"
      aria-label={label}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}
