import { useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Bold, Code, Heading1, Heading2, Heading3, ImagePlus, Italic, Link, List, ListOrdered, ListTodo, Minus, Plus, Quote, SquareCode, Strikethrough, Table2 } from "../../icons";
import type { LucideIcon } from "lucide-react";
import { FORMAT_ACTIONS, type FormatAction } from "./formatActions";
import type { InlineAction } from "./markdownEdit";
import { colorValueFromCss, DEFAULT_TEXT_COLORS } from "./textColor";

export type TextColorId = typeof DEFAULT_TEXT_COLORS[number]["id"];

export const EDITOR_FONT_DEFAULT = 100;
const EDITOR_FONT_MIN = 80;
const EDITOR_FONT_MAX = 150;
const EDITOR_FONT_STEP = 10;

export interface FormatBarColors {
  current: TextColorId;
  apply: (color: string | null, choice?: TextColorId) => void;
}

interface FormatBarProps {
  active: readonly InlineAction[];
  onAction: (action: FormatAction) => void;
  disabled: boolean;
  actions?: readonly FormatAction[];
  colors?: FormatBarColors;
  fontSize?: { percent: number; onChange: (percent: number) => void };
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
export function FormatBar({ active, onAction, disabled, actions = FORMAT_ACTIONS, colors, fontSize }: FormatBarProps) {
  const inline = actions.filter((action) => action.group === "inline");
  const block = actions.filter((action) => action.group === "block");
  return (
    <div className="mn-formatbar" role="toolbar" aria-label="格式">
      {(actions.length > 0 || colors) && <div className="mn-formatbar-actions">
        {inline.map((action) => (
          <FormatButton key={action.id} action={action} pressed={active.includes(action.id as InlineAction)} disabled={disabled} onAction={onAction} />
        ))}
        {colors && <ColorPicker {...colors} disabled={disabled} />}
        {block.length > 0 && <span className="mn-formatbar-gap" aria-hidden="true" />}
        {block.map((action) => (
          <FormatButton key={action.id} action={action} pressed={false} disabled={disabled} onAction={onAction} />
        ))}
      </div>}
      {fontSize && (
        <div className="mn-formatbar-size" role="group" aria-label="编辑字号">
          <button type="button" className="mn-formatbtn" title="减小编辑字号" aria-label="减小编辑字号"
            disabled={disabled || fontSize.percent <= EDITOR_FONT_MIN} onMouseDown={(event) => event.preventDefault()}
            onClick={() => fontSize.onChange(fontSize.percent - EDITOR_FONT_STEP)}><Minus aria-hidden="true" /></button>
          <output aria-label="当前编辑字号">{fontSize.percent}%</output>
          <button type="button" className="mn-formatbtn" title="增大编辑字号" aria-label="增大编辑字号"
            disabled={disabled || fontSize.percent >= EDITOR_FONT_MAX} onMouseDown={(event) => event.preventDefault()}
            onClick={() => fontSize.onChange(fontSize.percent + EDITOR_FONT_STEP)}><Plus aria-hidden="true" /></button>
        </div>
      )}
    </div>
  );
}

function ColorPicker({ current, apply, disabled }: FormatBarColors & { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const indicator = useRef<HTMLElement>(null);
  const pointerType = useRef("");
  const suppressHover = useRef(false);
  const restoreFocus = useRef(false);
  const currentLabel = DEFAULT_TEXT_COLORS.find(({ id }) => id === current)?.label;

  const applyColor = (id: TextColorId, element: HTMLElement) => {
    const color = colorValueFromCss(getComputedStyle(element).color);
    if (color) apply(color, id);
    setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={(nextOpen, details) => {
      if (nextOpen && details.reason === "trigger-hover" && suppressHover.current) return;
      restoreFocus.current = details.reason === "escape-key";
      setOpen(nextOpen);
    }}>
      <Popover.Trigger type="button" className="mn-formatbtn mn-colorpicker-trigger" aria-label="字体颜色"
        title={`字体颜色：${currentLabel}`} openOnHover delay={180} disabled={disabled}
        onPointerDown={(event) => { pointerType.current = event.pointerType; }}
        onPointerLeave={() => { suppressHover.current = false; }}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          // 鼠标单击直接用当前色，触屏和键盘通过同一按钮进入色板。
          if (event.detail === 0 || pointerType.current !== "mouse") return;
          event.preventBaseUIHandler();
          suppressHover.current = true;
          if (indicator.current) applyColor(current, indicator.current);
        }}>
        <span aria-hidden="true">A</span><i ref={indicator} className="mn-color-ink" data-color={current} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="mn-colorpicker-positioner" align="start">
          <Popover.Popup className="mn-colorpicker-menu" aria-label="选择字体颜色"
            initialFocus={(type) => type === "keyboard"} finalFocus={() => restoreFocus.current}>
            {DEFAULT_TEXT_COLORS.map(({ id, label }) => (
              <button key={id} type="button" className="mn-color-swatch mn-color-ink" data-color={id}
                aria-label={label} title={label} aria-pressed={current === id} onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => applyColor(id, event.currentTarget)} />
            ))}
            <button type="button" className="mn-color-clear" onMouseDown={(event) => event.preventDefault()}
              onClick={() => { apply(null); setOpen(false); }}>清除颜色</button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
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
