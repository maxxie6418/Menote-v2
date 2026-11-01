import { useEffect, useLayoutEffect, useRef } from "react";
import { filterActions, type FormatAction } from "./formatActions";

interface SlashMenuProps {
  query: string;
  activeIndex: number;
  /** 相对编辑器容器的坐标，菜单贴着斜杠光标。 */
  position: { top: number; left: number };
  onHover: (index: number) => void;
  onPick: (action: FormatAction) => void;
}

/** 行首 `/` 菜单（FR-EDT-6）。内容与格式栏相同，按前缀过滤。 */
export function SlashMenu({ query, activeIndex, position, onHover, onPick }: SlashMenuProps) {
  const actions = filterActions(query);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const current = listRef.current?.querySelector<HTMLElement>("[aria-selected='true']");
    current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, query]);

  useLayoutEffect(() => {
    const menu = listRef.current;
    if (!menu) return;
    menu.style.setProperty("--mn-slashmenu-top", `${position.top}px`);
    menu.style.setProperty("--mn-slashmenu-left", `${position.left}px`);
  }, [position.top, position.left]);

  if (actions.length === 0) return null;
  return (
    <div ref={listRef} className="mn-slashmenu" role="listbox" aria-label="插入">
      {actions.map((action, index) => (
        <button
          key={action.id} type="button" role="option" aria-selected={index === activeIndex}
          className={index === activeIndex ? "on" : ""}
          onMouseEnter={() => onHover(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(action)}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
