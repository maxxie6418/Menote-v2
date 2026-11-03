import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuAction {
  label: string;
  onSelect: () => unknown | Promise<unknown>;
  destructive?: boolean;
  separatorBefore?: boolean;
  /** 不可用时置灰并跳过，不触发 onSelect。 */
  disabled?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  label: string;
  actions: ContextMenuAction[];
  onClose: () => void;
  returnFocus?: HTMLElement | null;
}

/** Body portal keeps the menu visible above sidebar/list scroll containers. */
export function ContextMenu({ x, y, label, actions, onClose, returnFocus }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  // 位置必须按视口夹取，纯 CSS 算不出来；用命令式写 left/top（结构门禁禁止 JSX 内联 style）。
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    const gutter = 8;
    menu.style.left = `${Math.max(gutter, Math.min(x, window.innerWidth - bounds.width - gutter))}px`;
    menu.style.top = `${Math.max(gutter, Math.min(y, window.innerHeight - bounds.height - gutter))}px`;
  }, [x, y, actions.length, error]);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) onClose();
    };
    const closeOnViewportChange = () => onClose();
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("scroll", closeOnViewportChange, true);
    window.addEventListener("resize", closeOnViewportChange);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("scroll", closeOnViewportChange, true);
      window.removeEventListener("resize", closeOnViewportChange);
    };
  }, [onClose]);

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      returnFocus?.focus();
      return;
    }
    if (event.key === "Tab") {
      onClose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button[role='menuitem']:not([disabled])") ?? []);
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? buttons.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return createPortal(
    <div
      ref={menuRef}
      className="mn-contextmenu"
    >
      {error && <p className="mn-contextmenu-error" role="alert">{error}</p>}
      <div role="menu" aria-label={label} onKeyDown={onMenuKeyDown}>
        {actions.map((action) => (
          <div className="mn-contextmenu-entry" key={action.label} role="none">
            {action.separatorBefore && <div className="mn-contextmenu-separator" role="separator" />}
            <button
              type="button"
              role="menuitem"
              autoFocus={actions[0] === action}
              disabled={action.disabled}
              aria-disabled={action.disabled || undefined}
              className={action.destructive ? "mn-contextmenu-item danger" : "mn-contextmenu-item"}
              onClick={async () => {
                if (action.disabled) return;
                setError(null);
                try {
                  await action.onSelect();
                  onClose();
                if (returnFocus?.isConnected) returnFocus.focus();
                } catch {
                  setError("操作失败，请稍后重试。");
                }
              }}
            >
              {action.label}
            </button>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
