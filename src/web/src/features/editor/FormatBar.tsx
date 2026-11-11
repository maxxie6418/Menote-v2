import { useState } from "react";
import { Bold, Code, Heading1, Heading2, Heading3, ImagePlus, Italic, Link, List, ListOrdered, ListTodo, Minus, Quote, SquareCode, Strikethrough, Table2 } from "../../icons";
import type { LucideIcon } from "lucide-react";
import { FORMAT_ACTIONS, type FormatAction } from "./formatActions";
import type { InlineAction } from "./markdownEdit";
import { colorValueFromCss, DEFAULT_TEXT_COLORS } from "./textColor";

interface FormatBarProps {
  active: readonly InlineAction[];
  onAction: (action: FormatAction) => void;
  disabled: boolean;
  actions?: readonly FormatAction[];
  onSetTextColor?: (color: string | null) => void;
}

/** 动作 → 图标：文字标签留在 title/aria-label 里，按钮本身只出图形，窄栏也不会折行。 */
const ACTION_ICONS: Record<string, LucideIcon> = {
  bold: Bold,
  italic: Italic,
  strike: Strikethrough,
  code: Code,
  link: Link,
  heading1: Heading1,
  heading2: Heading2,
  heading3: Heading3,
  bullet: List,
  ordered: ListOrdered,
  task: ListTodo,
  quote: Quote,
  codeblock: SquareCode,
  hr: Minus,
  table: Table2,
  image: ImagePlus,
};

/** 正文上方常驻格式栏（FR-EDT-4）。预览态由调用方不渲染。 */
export function FormatBar({ active, onAction, disabled, actions, onSetTextColor }: FormatBarProps) {
  const [colorsOpen, setColorsOpen] = useState(false);
  const inline = actions?.filter((action) => action.group === "inline") ?? FORMAT_ACTIONS.filter((action) => action.group === "inline");
  const block = actions?.filter((action) => action.group === "block") ?? FORMAT_ACTIONS.filter((action) => action.group === "block");
  return (
    <div className="mn-formatbar" role="toolbar" aria-label="格式">
      {inline.map((action) => (
        <FormatButton key={action.id} action={action} pressed={active.includes(action.id as InlineAction)} disabled={disabled} onAction={onAction} />
      ))}
      {onSetTextColor && <span className="mn-colorpicker">
        <button type="button" className="mn-formatbtn mn-colorpicker-trigger" aria-label="字体颜色" title="字体颜色" aria-expanded={colorsOpen} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => setColorsOpen((open) => !open)}>
          <span aria-hidden="true">A</span><i aria-hidden="true" />
        </button>
        {colorsOpen && <span className="mn-colorpicker-menu" role="group" aria-label="选择字体颜色">
          {DEFAULT_TEXT_COLORS.map(({ id, label }) => <button key={id} type="button" className="mn-color-swatch" data-color={id} aria-label={label} title={label}
            onMouseDown={(event) => event.preventDefault()} onClick={(event) => {
              const color = colorValueFromCss(getComputedStyle(event.currentTarget).color);
              if (color) onSetTextColor(color);
              setColorsOpen(false);
            }} />)}
          <button type="button" className="mn-color-clear" onMouseDown={(event) => event.preventDefault()} onClick={() => { onSetTextColor(null); setColorsOpen(false); }}>清除颜色</button>
        </span>}
      </span>}
      <span className="mn-formatbar-gap" aria-hidden="true" />
      {block.map((action) => (
        <FormatButton key={action.id} action={action} pressed={false} disabled={disabled} onAction={onAction} />
      ))}
    </div>
  );
}

function FormatButton({ action, pressed, disabled, onAction }: { action: FormatAction; pressed: boolean; disabled: boolean; onAction: (action: FormatAction) => void }) {
  const Icon = ACTION_ICONS[action.id];
  return (
    <button
      type="button" className="mn-formatbtn" aria-label={action.label} title={action.label} aria-pressed={pressed}
      disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => onAction(action)}
    >
      {Icon ? <Icon aria-hidden="true" /> : action.label}
    </button>
  );
}
