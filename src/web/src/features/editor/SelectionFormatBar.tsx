import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { FormatBar, type FormatBarColors, type FormatBarTextStyles } from "./FormatBar";
import type { FormatAction } from "./formatActions";
import type { InlineAction } from "./markdownEdit";

interface SelectionFormatBarProps {
  x: number;
  y: number;
  active: readonly InlineAction[];
  actions: readonly FormatAction[];
  onAction: (action: FormatAction) => void;
  hostRef: RefObject<HTMLDivElement | null>;
  colors?: FormatBarColors;
  textStyles?: FormatBarTextStyles;
  onDismiss: () => void;
}

/** 选区上方的行内样式快捷栏；按钮按下时保留编辑器原选区。 */
export function SelectionFormatBar({ x, y, active, actions, onAction, hostRef, colors, textStyles, onDismiss }: SelectionFormatBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    const gutter = 8;
    const above = y >= bounds.height + gutter;
    const left = Math.max(gutter + bounds.width / 2, Math.min(x, window.innerWidth - gutter - bounds.width / 2));
    const top = above ? y : Math.min(window.innerHeight - bounds.height - gutter, y + bounds.height + 12);
    element.style.left = `${left}px`;
    element.style.top = `${Math.max(gutter, top)}px`;
    element.style.transform = above ? "translate(-50%, -100%)" : "translate(-50%, 0)";
  }, [x, y, actions.length]);

  useEffect(() => {
    const inTools = (target: EventTarget | null) => target instanceof Element
      && (ref.current?.contains(target) || target.closest(".mn-colorpicker-menu"));
    const outside = (event: Event) => {
      if (!inTools(event.target)) onDismiss();
    };
    const selectionChanged = () => {
      const selection = window.getSelection();
      if (inTools(document.activeElement)) return;
      if (!selection || selection.isCollapsed || !hostRef.current?.contains(selection.anchorNode)
        || !hostRef.current.contains(selection.focusNode)) onDismiss();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (inTools(document.activeElement)) hostRef.current?.querySelector<HTMLElement>("[contenteditable=true]")?.focus();
      onDismiss();
    };
    const focusChanged = (event: FocusEvent) => {
      if (event.target instanceof Node && hostRef.current?.contains(event.target)) return;
      outside(event);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", focusChanged);
    document.addEventListener("selectionchange", selectionChanged);
    document.addEventListener("keydown", keyDown);
    document.addEventListener("scroll", outside, true);
    window.addEventListener("blur", onDismiss);
    window.addEventListener("resize", onDismiss);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", focusChanged);
      document.removeEventListener("selectionchange", selectionChanged);
      document.removeEventListener("keydown", keyDown);
      document.removeEventListener("scroll", outside, true);
      window.removeEventListener("blur", onDismiss);
      window.removeEventListener("resize", onDismiss);
    };
  }, [hostRef, onDismiss]);

  return (
    <div ref={ref} className="mn-selection-formatbar" aria-label="选中文本格式">
      <FormatBar active={active} disabled={false} onAction={onAction} actions={actions} colors={colors} textStyles={textStyles} />
    </div>
  );
}
