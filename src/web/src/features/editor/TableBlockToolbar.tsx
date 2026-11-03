import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Eraser, Rows3, Trash2 } from "lucide-react";
import { ContextMenu } from "../../components/ui/ContextMenu";
import type { EditorAdapter } from "./EditorAdapter";
import type { TableAlign, TableCommandId, TableContext } from "./tableCommands";

/**
 * 表格块操作（FR-EDT-9 / TP4 · W2）。
 *
 * 两种形式、同一套命令：
 * - **浮出工具条**：鼠标移入表格时浮在表格上方；
 * - **右键菜单**：在表格里右键，菜单项与工具条一一对应。
 *
 * 键盘（仅所见即所得态）：
 * - Tab / Shift+Tab 在单元格间移动（Milkdown gfm 预设自带）；
 * - **末格按 Tab 追加一行**（本组件接管，表格不再「走不出」）；
 * - **首格按 Shift+Tab 焦点进入工具条**，可用键盘完成全部命令；Esc 回到正文。
 *
 * 只服务 Note 正文里的 GFM 表格块；TP2 的整页表格不走这里。
 */

interface CommandSpec {
  id: TableCommandId;
  label: string;
  icon: typeof ArrowUp;
  group: "row" | "col" | "align" | "misc";
  /** 对齐类命令：对应的对齐值，用于判断按下态。 */
  align?: TableAlign;
}

const COMMANDS: CommandSpec[] = [
  { id: "row-above", label: "在上方插入行", icon: ArrowUp, group: "row" },
  { id: "row-below", label: "在下方插入行", icon: ArrowDown, group: "row" },
  { id: "row-delete", label: "删除本行", icon: Trash2, group: "row" },
  { id: "col-left", label: "在左侧插入列", icon: ArrowLeft, group: "col" },
  { id: "col-right", label: "在右侧插入列", icon: ArrowRight, group: "col" },
  { id: "col-delete", label: "删除本列", icon: Trash2, group: "col" },
  { id: "align-left", label: "左对齐", icon: AlignLeft, group: "align", align: "left" },
  { id: "align-center", label: "居中", icon: AlignCenter, group: "align", align: "center" },
  { id: "align-right", label: "右对齐", icon: AlignRight, group: "align", align: "right" },
  { id: "align-default", label: "清除对齐", icon: Eraser, group: "align", align: null },
  { id: "clear-format", label: "清除本表格式", icon: Rows3, group: "misc" },
];

const GROUPS: CommandSpec["group"][] = ["row", "col", "align", "misc"];

/** 命令在当前上下文下是否可用（表头上方不能插行、只剩一行数据不能删行、只剩一列不能删列）。 */
function isDisabled(command: TableCommandId, context: TableContext): boolean {
  if (command === "row-above") return !context.canInsertRowAbove;
  if (command === "row-delete") return !context.canDeleteRow;
  if (command === "col-delete") return !context.canDeleteColumn;
  return false;
}

/** 找到鼠标下的表格单元格。 */
function cellOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  const cell = target.closest("td, th");
  return cell instanceof HTMLElement ? cell : null;
}

/** 光标所在的表格单元格（键盘用户也能看到工具条）。 */
function selectionCell(): HTMLElement | null {
  const selection = typeof window === "undefined" ? null : window.getSelection();
  const node = selection?.anchorNode;
  if (!node) return null;
  const element = node instanceof HTMLElement ? node : node.parentElement;
  const cell = element?.closest("td, th");
  return cell instanceof HTMLElement ? cell : null;
}

/** 表格里第一个 / 最后一个单元格（DOM 序）。 */
function edgeCell(table: HTMLElement, edge: "first" | "last"): HTMLElement | null {
  const rows = Array.from(table.querySelectorAll("tr"));
  const row = edge === "first" ? rows[0] : rows[rows.length - 1];
  if (!row) return null;
  const cells = Array.from(row.querySelectorAll("td, th"));
  const cell = edge === "first" ? cells[0] : cells[cells.length - 1];
  return cell instanceof HTMLElement ? cell : null;
}

interface ActiveTarget {
  cell: HTMLElement;
  context: TableContext;
}

interface MenuTarget {
  cell: HTMLElement;
  x: number;
  y: number;
}

interface TableBlockToolbarProps {
  /** 当前适配器（异步创建，用取值器避免重建组件）。 */
  getAdapter: () => EditorAdapter | null;
  /** 编辑器宿主元素。 */
  hostRef: RefObject<HTMLDivElement | null>;
}

export function TableBlockToolbar({ getAdapter, hostRef }: TableBlockToolbarProps) {
  const [active, setActive] = useState<ActiveTarget | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const menuRef = useRef<MenuTarget | null>(null);
  menuRef.current = menu;
  const [above, setAbove] = useState(true);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);

  // 位置用命令式写（结构门禁禁止 JSX 内联 style）。
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar || !position) return;
    bar.style.top = `${position.top}px`;
    bar.style.left = `${position.left}px`;
  }, [position]);

  const cancelHide = () => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const scheduleHide = () => {
    cancelHide();
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null;
      // 光标仍在表格里就继续显示（键盘用户的工具条不能因为鼠标离开而消失）。
      if (selectionCell()) return;
      setActive(null);
    }, 180);
  };

  /** 目标单元格变化时更新位置与上下文。 */
  const applyCell = useCallback((cell: HTMLElement) => {
    const adapter = getAdapter();
    if (!adapter?.getTableContextAt) return;
    const context = adapter.getTableContextAt(cell);
    if (!context) return;
    const table = cell.closest("table");
    const host = hostRef.current;
    const wrap = host?.closest(".mn-editor-wrap");
    if (!(table instanceof HTMLElement) || !host || !wrap) return;
    const tableRect = table.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const top = tableRect.top - wrapRect.top;
    setPosition({ top, left: tableRect.left - wrapRect.left });
    setAbove(top > 48);
    setActive({ cell, context });
  }, [getAdapter, hostRef]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onOver = (event: MouseEvent) => {
      const cell = cellOf(event.target);
      if (!cell || !host.contains(cell)) return;
      cancelHide();
      applyCell(cell);
    };
    const onLeave = () => scheduleHide();
    const onContext = (event: MouseEvent) => {
      const cell = cellOf(event.target);
      if (!cell || !host.contains(cell)) return;
      event.preventDefault();
      cancelHide();
      applyCell(cell);
      setMenu({ cell, x: event.clientX, y: event.clientY });
    };
    /** 光标位置变化（点击、方向键、Tab 换格）后同步工具条。 */
    const onCursorMove = () => {
      const cell = selectionCell();
      if (!cell || !host.contains(cell)) {
        if (!menuRef.current) setActive(null);
        return;
      }
      applyCell(cell);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const cell = selectionCell();
      if (!cell || !host.contains(cell)) return;
      const table = cell.closest("table");
      if (!(table instanceof HTMLElement)) return;
      if (!event.shiftKey) {
        // 末格按 Tab：追加一行（否则表格最后一个格子是死路）。
        if (cell !== edgeCell(table, "last")) return;
        event.preventDefault();
        getAdapter()?.runTableCommand?.("row-below", cell);
        return;
      }
      // 首格按 Shift+Tab：焦点进入工具条，键盘用户也能操作表格。
      if (cell !== edgeCell(table, "first")) return;
      event.preventDefault();
      const button = barRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])");
      button?.focus();
    };
    const onKeyUp = () => onCursorMove();
    host.addEventListener("mouseover", onOver);
    host.addEventListener("mouseleave", onLeave);
    host.addEventListener("contextmenu", onContext);
    host.addEventListener("keydown", onKeyDown);
    host.addEventListener("keyup", onKeyUp);
    host.addEventListener("mouseup", onCursorMove);
    return () => {
      host.removeEventListener("mouseover", onOver);
      host.removeEventListener("mouseleave", onLeave);
      host.removeEventListener("contextmenu", onContext);
      host.removeEventListener("keydown", onKeyDown);
      host.removeEventListener("keyup", onKeyUp);
      host.removeEventListener("mouseup", onCursorMove);
      cancelHide();
    };
  }, [hostRef, applyCell, getAdapter]);

  const run = (command: TableCommandId, cell: HTMLElement) => {
    const adapter = getAdapter();
    if (!adapter?.runTableCommand) return;
    if (adapter.runTableCommand(command, cell)) {
      // 表格结构变了，重新取上下文（列数与对齐都可能变）；光标可能已经落到别的格子，以光标为准。
      window.requestAnimationFrame(() => {
        const next = selectionCell();
        applyCell(next && hostRef.current?.contains(next) ? next : cell);
      });
    }
  };

  const currentAlign = active?.context.align[active.context.colIndex] ?? null;

  const menuActions = menu && active
    ? GROUPS.flatMap((group, groupIndex) =>
      COMMANDS.filter((spec) => spec.group === group).map((spec, index) => ({
        label: spec.label,
        separatorBefore: groupIndex > 0 && index === 0,
        disabled: isDisabled(spec.id, active.context),
        onSelect: () => run(spec.id, menu.cell),
      })),
    )
    : [];

  return (
    <>
      {active && (
        <div
          ref={barRef}
          className="mn-tablebar"
          data-above={above ? "true" : "false"}
          role="toolbar"
          aria-label="表格操作"
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            // 焦点回到正文（编辑器本体是可编辑区，宿主容器本身不可聚焦）。
            const editable = hostRef.current?.querySelector<HTMLElement>("[contenteditable='true']");
            editable?.focus();
          }}
        >
          {COMMANDS.map((spec) => {
            const Icon = spec.icon;
            const pressed = spec.group === "align" && spec.align === currentAlign;
            const disabled = isDisabled(spec.id, active.context);
            return (
              <button
                key={spec.id}
                type="button"
                className="mn-tablebar-btn"
                aria-label={spec.label}
                title={spec.label}
                aria-pressed={spec.group === "align" ? pressed : undefined}
                aria-disabled={disabled || undefined}
                data-pressed={pressed ? "true" : undefined}
                data-disabled={disabled ? "true" : undefined}
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => run(spec.id, active.cell)}
              >
                <Icon aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label="表格操作"
          actions={menuActions}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
