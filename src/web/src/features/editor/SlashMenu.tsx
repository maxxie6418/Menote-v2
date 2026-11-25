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
  return <EditorChoiceMenu label="插入" options={actions} activeIndex={activeIndex} position={position}
    onHover={onHover} onPick={(index) => { const action = actions[index]; if (action) onPick(action); }} />;
}

export function EditorChoiceMenu({ label, options, activeIndex, position, onHover, onPick }: {
  label: string;
  options: readonly { id: string; label: string; detail?: string }[];
  activeIndex: number;
  position: SlashMenuProps["position"];
  onHover: (index: number) => void;
  onPick: (index: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const current = listRef.current?.querySelector<HTMLElement>("[aria-selected='true']");
    current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, options]);

  useLayoutEffect(() => {
    const menu = listRef.current;
    if (!menu) return;
    menu.style.setProperty("--mn-slashmenu-top", `${position.top}px`);
    menu.style.setProperty("--mn-slashmenu-left", `${position.left}px`);
  }, [position.top, position.left]);

  if (options.length === 0) return null;
  return (
    <div ref={listRef} className="mn-slashmenu" role="listbox" aria-label={label}>
      {options.map((option, index) => (
        <button
          key={option.id} type="button" role="option" aria-selected={index === activeIndex}
          className={index === activeIndex ? "on" : ""}
          onMouseEnter={() => onHover(index)}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(index)}
        >
          {option.label}{option.detail && <small className="mn-slashmenu-detail">{option.detail}</small>}
        </button>
      ))}
    </div>
  );
}
