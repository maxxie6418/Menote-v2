import { FORMAT_ACTIONS, type FormatAction } from "./formatActions";
import type { InlineAction } from "./markdownEdit";

interface FormatBarProps {
  active: readonly InlineAction[];
  onAction: (action: FormatAction) => void;
  disabled: boolean;
}

/** 正文上方常驻格式栏（FR-EDT-4）。预览态由调用方不渲染。 */
export function FormatBar({ active, onAction, disabled }: FormatBarProps) {
  const inline = FORMAT_ACTIONS.filter((action) => action.group === "inline");
  const block = FORMAT_ACTIONS.filter((action) => action.group === "block");
  return (
    <div className="mn-formatbar" role="toolbar" aria-label="格式">
      {inline.map((action) => (
        <FormatButton key={action.id} action={action} pressed={active.includes(action.id as InlineAction)} disabled={disabled} onAction={onAction} />
      ))}
      <span className="mn-formatbar-gap" aria-hidden="true" />
      {block.map((action) => (
        <FormatButton key={action.id} action={action} pressed={false} disabled={disabled} onAction={onAction} />
      ))}
    </div>
  );
}

function FormatButton({ action, pressed, disabled, onAction }: { action: FormatAction; pressed: boolean; disabled: boolean; onAction: (action: FormatAction) => void }) {
  return (
    <button
      type="button" className="mn-formatbtn" aria-label={action.label} title={action.label} aria-pressed={pressed}
      disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => onAction(action)}
    >
      {action.label}
    </button>
  );
}
