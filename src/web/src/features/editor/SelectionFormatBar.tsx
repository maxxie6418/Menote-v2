import { useLayoutEffect, useRef } from "react";
import { FormatBar } from "./FormatBar";
import type { FormatAction } from "./formatActions";
import type { InlineAction } from "./markdownEdit";

interface SelectionFormatBarProps {
  x: number;
  y: number;
  active: readonly InlineAction[];
  actions: readonly FormatAction[];
  onAction: (action: FormatAction) => void;
}

/** 选区上方的行内样式快捷栏；按钮按下时保留编辑器原选区。 */
export function SelectionFormatBar({ x, y, active, actions, onAction }: SelectionFormatBarProps) {
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

  return (
    <div ref={ref} className="mn-selection-formatbar" aria-label="选中文本格式">
      <FormatBar active={active} disabled={false} onAction={onAction} actions={actions} />
    </div>
  );
}
