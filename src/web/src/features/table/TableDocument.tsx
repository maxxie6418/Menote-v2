import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent as ReactDragEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Copy, Filter, GripVertical, Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  FIELDS_KEY, OPTION_COLORS, readDefs, removeDef, renameDef, reorderDefs, splitFrontmatter, writeDef,
  type OptionColor, type PropertyDef, type PropertyType,
} from "../../lib/frontmatter";
import { findTables, joinMultiCell, renderTable, replaceTable, splitMultiCell, type ParsedTable } from "../../lib/gfmTable";
import { AnchoredPanel } from "../../components/ui/AnchoredPanel";
import { TableCellEditor } from "./TableCellEditor";
import { FIELD_TYPE_LABELS, FieldTypeMenu } from "./FieldTypeMenu";
import { compareGridValues, matchesGridFilter, parseGridClipboard, validateGridPaste } from "./tableGrid";
import { readHiddenTableColumns, readTableColumnWidths, writeHiddenTableColumns, writeTableColumnWidths } from "../../services/tablePreferencesService";
import { readHiddenColumnsSetting, updateHiddenColumnsSetting } from "../../services/tableViewSettingsService";
import { TableColumnVisibility } from "./TableColumnVisibility";
import { TableRowDetailsPanel } from "./TableRowDetailsPanel";

interface TableDocumentProps {
  userId: string;
  itemId: string;
  /** 全文（frontmatter + 正文），受控：编辑即回调整篇。 */
  markdown: string;
  onChangeMarkdown: (next: string) => void;
  /** 正文存在但表格结构无法解析时触发（FR-VER-2 降级，封存在服务层）。 */
  onDegrade: () => void;
  /** 空白表格文档切回普通笔记（仅空白期可用，守卫在 setItemForm）。 */
  onSwitchToNote: () => void;
}

const joinDoc = (frontText: string | null, body: string): string => (frontText ? `${frontText}\n\n${body}` : body);
const OPTION_COLOR_LABELS: Record<OptionColor, string> = {
  neutral: "默认", red: "红", orange: "橙", yellow: "黄", green: "绿", teal: "青", blue: "蓝", purple: "紫", pink: "粉",
};

function removeFirstTable(body: string): string {
  const table = findTables(body)[0];
  if (!table) return body;
  const lines = body.split(/\r?\n/);
  lines.splice(table.startLine, table.endLine - table.startLine + 1);
  return lines.join("\n").replace(/^[ \t]*\n+/, "").trimEnd();
}

/** 多维表格整页网格（TP2）：列管理 + 行管理 + 类型化单元格编辑；载体永远是标准 GFM（FR-TBL-1）。
 *  字段定义写 YAML `fields:`（FR-TBL-3）；与属性区共用同一套类型与序列化（FR-PROP-4）。 */
export function TableDocument({ userId, itemId, markdown, onChangeMarkdown, onDegrade, onSwitchToNote }: TableDocumentProps) {
  const { frontText, body } = useMemo(() => splitFrontmatter(markdown), [markdown]);
  const fieldDefs = useMemo(() => readDefs(markdown, FIELDS_KEY), [markdown]);
  const table: ParsedTable | undefined = useMemo(() => findTables(body)[0], [body]);
  const blank = !/\S/.test(body);

  const [menuCol, setMenuCol] = useState<number | null>(null);
  const [addingCol, setAddingCol] = useState(false);
  const [renames, setRenames] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [draggingRow, setDraggingRow] = useState<number | null>(null);
  const [draggingColumn, setDraggingColumn] = useState<number | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(() => new Set());
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(() => readHiddenTableColumns(userId, itemId));
  const [detailRow, setDetailRow] = useState<number | null>(null);
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [filterCol, setFilterCol] = useState(0);
  const [filterOperator, setFilterOperator] = useState("contains");
  const [filterValue, setFilterValue] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [undoLabel, setUndoLabel] = useState<string | null>(null);
  const undoMarkdown = useRef<string | null>(null);
  const [columnWidths, setColumnWidths] = useState<number[]>(() => readTableColumnWidths(userId, itemId));
  const columnWidthsRef = useRef(columnWidths);
  const resizeRef = useRef<{ col: number; startX: number; startLevel: number } | null>(null);
  const touchColumnDrag = useRef<{ source: number; target: number; after: boolean } | null>(null);
  const reorderColumnRef = useRef<(from: number, to: number, after?: boolean) => void>(() => undefined);
  const touchDrag = useRef<{ source: number; target: number; rows: number[] } | null>(null);
  const pendingColumnFocus = useRef<number | null>(null);
  const pendingRowFocus = useRef<{ row: number; col: number } | null>(null);
  const hiddenColumnsLoad = useRef(0);

  useEffect(() => {
    const widths = readTableColumnWidths(userId, itemId);
    columnWidthsRef.current = widths;
    setColumnWidths(widths);
    const cachedHidden = readHiddenTableColumns(userId, itemId);
    setHiddenColumns(cachedHidden);
    setDetailRow(null);
    setSelectedRows(new Set());
    setSortCol(null);
    setFilterValue("");
    const generation = ++hiddenColumnsLoad.current;
    let active = true;
    const loadSyncedColumns = async (expectedGeneration: number, migrateLocal = false) => {
      const synced = await readHiddenColumnsSetting(userId, itemId);
      if (!active || expectedGeneration !== hiddenColumnsLoad.current) return;
      const next = synced ?? cachedHidden;
      setHiddenColumns(next);
      writeHiddenTableColumns(userId, itemId, next);
      if (synced === null && migrateLocal && cachedHidden.length) {
        void updateHiddenColumnsSetting(userId, itemId, cachedHidden);
      }
    };
    const onSynced = () => { void loadSyncedColumns(hiddenColumnsLoad.current); };
    void loadSyncedColumns(generation, true);
    window.addEventListener("menote:table-view-settings", onSynced);
    return () => {
      active = false;
      window.removeEventListener("menote:table-view-settings", onSynced);
    };
  }, [userId, itemId]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (touchColumnDrag.current && event.pointerType === "touch") {
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-column-index]");
        const targetCol = Number(target?.dataset.columnIndex);
        if (Number.isInteger(targetCol) && target) {
          touchColumnDrag.current.target = targetCol;
          touchColumnDrag.current.after = event.clientX >= target.getBoundingClientRect().left + target.getBoundingClientRect().width / 2;
        }
      }
      const resize = resizeRef.current;
      if (!resize) return;
      const nextLevel = Math.max(0, Math.min(7, resize.startLevel + Math.round((event.clientX - resize.startX) / 24)));
      const next = [...columnWidthsRef.current];
      next[resize.col] = nextLevel;
      columnWidthsRef.current = next;
      setColumnWidths(next);
    };
    const onUp = () => {
      if (touchColumnDrag.current) {
        const drag = touchColumnDrag.current;
        touchColumnDrag.current = null;
        reorderColumnRef.current(drag.source, drag.target, drag.after);
      }
      if (resizeRef.current) {
        resizeRef.current = null;
        writeTableColumnWidths(userId, itemId, columnWidthsRef.current);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [userId, itemId]);

  const updateColumnWidth = (col: number, level: number) => {
    const next = [...columnWidthsRef.current];
    next[col] = level;
    columnWidthsRef.current = next;
    setColumnWidths(next);
    writeTableColumnWidths(userId, itemId, next);
  };

  /* 脚手架态（正文无表格）：列由 fields: 推导；首个字段/首行写入后进入网格态。 */
  const scaffoldHeader = table ? null : Object.keys(fieldDefs);
  const header = table?.header ?? scaffoldHeader ?? [];
  const visibleColumnIndices = header.map((_, index) => index).filter((index) => !hiddenColumns.includes(header[index]!));

  const toggleColumnVisibility = (column: string, visible: boolean) => {
    const next = visible ? hiddenColumns.filter((name) => name !== column) : [...new Set([...hiddenColumns, column])];
    hiddenColumnsLoad.current += 1;
    setHiddenColumns(next);
    writeHiddenTableColumns(userId, itemId, next);
    void updateHiddenColumnsSetting(userId, itemId, next);
  };

  const applyGrid = (header: string[], rows: string[][]) => {
    if (table) {
      onChangeMarkdown(joinDoc(frontText, replaceTable(body, 0, { ...table, header, rows })));
    } else {
      const tableText = renderTable(header, rows);
      const trimmed = body.trimEnd();
      onChangeMarkdown(joinDoc(frontText, trimmed ? `${trimmed}\n\n${tableText}\n` : `${tableText}\n`));
    }
  };

  const columnType = (col: number): PropertyType => {
    const name = (table?.header[col] ?? scaffoldHeader?.[col] ?? "").trim();
    const def = fieldDefs[name];
    return def ? def.type : "text";
  };

  const saveUndoPoint = (label: string) => {
    undoMarkdown.current = markdown;
    setUndoLabel(label);
  };

  const clearUndo = () => {
    undoMarkdown.current = null;
    setUndoLabel(null);
  };

  const undoLastBulkAction = () => {
    if (!undoMarkdown.current) return;
    onChangeMarkdown(undoMarkdown.current);
    if (undoLabel === "排序") setSortCol(null);
    undoMarkdown.current = null;
    setUndoLabel(null);
    setSelectedRows(new Set());
  };

  const fieldAt = (col: number) => {
    const name = (table?.header[col] ?? scaffoldHeader?.[col] ?? "").trim();
    return { type: columnType(col), def: fieldDefs[name] };
  };

  const toggleSort = (col: number) => {
    if (!table) return;
    const direction = sortCol === col ? (sortDirection === "asc" ? "desc" : "asc") : "asc";
    const sorted = [...table.rows].sort((a, b) => {
      const left = a[col] ?? "";
      const right = b[col] ?? "";
      if (left === "") return right === "" ? 0 : 1;
      if (right === "") return -1;
      return compareGridValues(left, right, fieldAt(col)) * (direction === "asc" ? 1 : -1);
    });
    saveUndoPoint("排序");
    applyGrid(table.header, sorted);
    setSortCol(col);
    setSortDirection(direction);
    setSelectedRows(new Set());
  };

  const clearSort = () => { setSortCol(null); setSelectedRows(new Set()); };

  const reorderColumn = (from: number, to: number, after = false) => {
    if (from === to || from < 0 || to < 0 || from >= header.length || to >= header.length) { setDraggingColumn(null); return; }
    const order = header.map((_, index) => index);
    const [moved] = order.splice(from, 1);
    const insertion = Math.max(0, Math.min(order.length, to + (after ? 1 : 0) - (from < to + (after ? 1 : 0) ? 1 : 0)));
    order.splice(insertion, 0, moved);
    const names = order.map((index) => header[index]);
    let next = reorderDefs(markdown, FIELDS_KEY, names);
    if (table) {
      const nextBody = splitFrontmatter(next).body;
      const currentTable = findTables(nextBody)[0];
      if (currentTable) {
        const rows = table.rows.map((row) => order.map((index) => row[index] ?? ""));
        next = joinDoc(splitFrontmatter(next).frontText, replaceTable(nextBody, 0, {
          ...currentTable, header: names, rows,
        }));
      }
    }
    saveUndoPoint("列顺序");
    onChangeMarkdown(next);
    setDraggingColumn(null);
    setSelectedRows(new Set());
    setSortCol(null);
    setFilterCol(0);
    setMenuCol(null);
  };
  reorderColumnRef.current = reorderColumn;

  const visibleRows = useMemo(() => {
    if (!table) return [];
    return table.rows.map((cells, rowIndex) => ({ cells, rowIndex })).filter(({ cells }) =>
      !filterValue || matchesGridFilter(cells[filterCol] ?? "", filterValue, filterOperator, fieldAt(filterCol)));
  }, [table, filterCol, filterOperator, filterValue, fieldDefs]);
  const activeSelection = new Set(visibleRows.filter(({ rowIndex }) => selectedRows.has(rowIndex)).map(({ rowIndex }) => rowIndex));

  const toggleRowSelection = (row: number, checked: boolean) => {
    setSelectedRows((current) => {
      const next = new Set(current);
      if (checked) next.add(row);
      else next.delete(row);
      return next;
    });
  };

  const selectVisibleRows = (checked: boolean) => {
    setSelectedRows((current) => {
      const next = new Set(current);
      for (const { rowIndex } of visibleRows) {
        if (checked) next.add(rowIndex);
        else next.delete(rowIndex);
      }
      return next;
    });
  };

  const deleteSelectedRows = () => {
    if (!table || activeSelection.size === 0) return;
    if (!window.confirm(`删除选中的 ${activeSelection.size} 行？`)) return;
    saveUndoPoint("批量删除");
    applyGrid(table.header, table.rows.filter((_, index) => !activeSelection.has(index)));
    setSelectedRows(new Set());
  };

  const copySelectedRows = async () => {
    if (!table || activeSelection.size === 0) return;
    const text = [...activeSelection].sort((a, b) => a - b).map((index) => (table.rows[index] ?? []).join("\t")).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setError(null);
    } catch {
      setError("无法访问剪贴板，请检查浏览器权限");
    }
  };

  const moveSelectedRows = (target: number, selected: Set<number> = activeSelection) => {
    if (!table || selected.size === 0) return;
    const moving = [...selected].sort((a, b) => a - b).map((index) => table.rows[index]).filter((row): row is string[] => Boolean(row));
    const remaining = table.rows.filter((_, index) => !selected.has(index));
    const insertAt = table.rows.slice(0, target).filter((_, index) => !selected.has(index)).length;
    remaining.splice(insertAt, 0, ...moving);
    saveUndoPoint("批量重排");
    applyGrid(table.header, remaining);
    setSortCol(null);
    setSelectedRows(new Set(moving.map((_, index) => insertAt + index)));
  };

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = touchDrag.current;
      if (!drag) return;
      const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".mn-tabledoc-row[data-row-index]");
      if (!row) return;
      drag.target = Number(row.dataset.rowIndex);
      setDraggingRow(drag.target);
    };
    const onUp = () => {
      const drag = touchDrag.current;
      if (!drag) return;
      touchDrag.current = null;
      if (drag.target !== drag.source) moveSelectedRows(drag.target, new Set(drag.rows));
      setDraggingRow(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [moveSelectedRows]);

  const pasteGrid = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!table) return;
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-row-index][data-col-index]");
    if (!cell) return;
    const text = event.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !/[\r\n]/.test(text)) return;
    event.preventDefault();
    const start = { row: Number(cell.dataset.rowIndex), col: Number(cell.dataset.colIndex) };
    const pasted = parseGridClipboard(text);
    const fields = table.header.map((name, col) => ({ ...fieldAt(col), name }));
    const issue = validateGridPaste(pasted, start, fields);
    if (issue) { setError(issue); return; }
    const rows = table.rows.map((row) => [...row]);
    const required = start.row + pasted.length;
    while (rows.length < required) rows.push(table.header.map(() => ""));
    for (let r = 0; r < pasted.length; r += 1) {
      for (let c = 0; c < pasted[r]!.length; c += 1) {
        const value = pasted[r]![c]!.trim();
        const field = fields[start.col + c]!;
        rows[start.row + r]![start.col + c] = field.type === "multiselect" ? joinMultiCell(splitMultiCell(value)) : value;
      }
    }
    saveUndoPoint("粘贴");
    applyGrid(table.header, rows);
    setError(null);
  };

  const handleGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const cell = target.closest<HTMLElement>("[data-row-index][data-col-index]");
    if (!cell || !table) return;
    const row = Number(cell.dataset.rowIndex);
    const col = Number(cell.dataset.colIndex);
    const visibleIndex = visibleRows.findIndex((entry) => entry.rowIndex === row);
    const visibleColIndex = visibleColumnIndices.indexOf(col);
    if (visibleColIndex < 0) return;
    const focusCell = (rowIndex: number, colIndex: number) => {
      const next = document.querySelector<HTMLElement>(`.mn-tabledoc-cell[data-row-index="${rowIndex}"][data-col-index="${colIndex}"] input, .mn-tabledoc-cell[data-row-index="${rowIndex}"][data-col-index="${colIndex}"] button`);
      next?.focus();
    };
    if (event.key === "Tab") {
      if (event.shiftKey && visibleColIndex === 0 && visibleIndex === 0) return;
      event.preventDefault();
      const nextVisibleCol = visibleColIndex + (event.shiftKey ? -1 : 1);
      if (nextVisibleCol >= 0 && nextVisibleCol < visibleColumnIndices.length) focusCell(row, visibleColumnIndices[nextVisibleCol]!);
      else if (event.shiftKey && visibleIndex > 0) focusCell(visibleRows[visibleIndex - 1]!.rowIndex, visibleColumnIndices.at(-1)!);
      else if (!event.shiftKey && visibleIndex < visibleRows.length - 1) focusCell(visibleRows[visibleIndex + 1]!.rowIndex, visibleColumnIndices[0]!);
      else if (!event.shiftKey) {
        addRow();
      }
    } else if (event.key === "Enter" && target instanceof HTMLInputElement && target.type !== "checkbox") {
      event.preventDefault();
      target.blur();
      if (visibleIndex >= 0 && visibleIndex < visibleRows.length - 1) focusCell(visibleRows[visibleIndex + 1]!.rowIndex, col);
      else if (visibleIndex === visibleRows.length - 1) {
        addRow();
      }
    }
  };

  /* ---------- 单元格与行 ---------- */

  const setCell = (row: number, col: number, value: string) => {
    if (!table) return;
    clearUndo();
    setSortCol(null);
    const rows = table.rows.map((cells, r) => (r === row ? cells.map((cell, c) => (c === col ? value : cell)) : cells));
    applyGrid(table.header, rows);
  };

  const addRow = () => {
    const header = table?.header ?? scaffoldHeader ?? [];
    if (header.length === 0) return;
    clearUndo();
    setFilterValue("");
    const rows = table ? [...table.rows, header.map(() => "")] : [header.map(() => "")];
    applyGrid(header, rows);
    pendingRowFocus.current = { row: rows.length - 1, col: visibleColumnIndices[0] ?? 0 };
  };

  const removeRow = (row: number) => {
    if (!table) return;
    clearUndo();
    setSortCol(null);
    applyGrid(table.header, table.rows.filter((_, index) => index !== row));
  };

  const moveRow = (from: number, to: number) => {
    if (!table || from === to || from < 0 || to < 0 || from >= table.rows.length || to >= table.rows.length) return;
    clearUndo();
    const rows = [...table.rows];
    const [moved] = rows.splice(from, 1);
    rows.splice(to, 0, moved);
    applyGrid(table.header, rows);
    setSortCol(null);
  };

  /* ---------- 列管理 ---------- */

  const addColumn = (name: string, type: PropertyType, options?: string[]) => {
    const clean = name.trim();
    if (!clean) { setError("字段名不能为空"); return; }
    const existing = table?.header ?? scaffoldHeader ?? [];
    if (existing.some((item) => item.trim() === clean)) { setError(`字段名「${clean}」已存在`); return; }
    clearUndo();
    const def: PropertyDef = options ? { type, options } : { type };
    if (!table && !frontText) {
      // 脚手架且无 frontmatter：writeDef 会创建；正文不变，脚手架由 fields: 重新推导。
      onChangeMarkdown(writeDef(markdown, FIELDS_KEY, clean, def));
      pendingColumnFocus.current = 0;
      setMenuCol(0);
      setAddingCol(false);
      setError(null);
      return;
    }
    let next = writeDef(markdown, FIELDS_KEY, clean, def);
    if (table) {
      const { frontText: ft, body: nextBody } = splitFrontmatter(next);
      const current = findTables(nextBody)[0];
      if (current) {
        next = joinDoc(ft, replaceTable(nextBody, 0, {
          ...current, header: [...current.header, clean], rows: current.rows.map((row) => [...row, ""]),
        }));
      }
    }
    onChangeMarkdown(next);
    pendingColumnFocus.current = existing.length;
    setMenuCol(existing.length);
    setAddingCol(false);
    setError(null);
  };

  useEffect(() => {
    const pendingColumn = pendingColumnFocus.current;
    const pendingRow = pendingRowFocus.current;
    if (pendingColumn !== null) {
      pendingColumnFocus.current = null;
      window.setTimeout(() => document.querySelectorAll<HTMLInputElement>(".mn-tabledoc-hname")[pendingColumn + 1]?.focus(), 0);
    }
    if (pendingRow) {
      pendingRowFocus.current = null;
      window.setTimeout(() => document.querySelector<HTMLElement>(`.mn-tabledoc-cell[data-row-index="${pendingRow.row}"][data-col-index="${pendingRow.col}"] input, .mn-tabledoc-cell[data-row-index="${pendingRow.row}"][data-col-index="${pendingRow.col}"] button`)?.focus(), 0);
    }
  }, [markdown, addingCol]);

  const commitRename = (col: number) => {
    if (!table) {
      // 脚手架：仅重命名 fields: 定义键
      const draft = renames[col];
      if (draft === undefined) return;
      const oldName = scaffoldHeader?.[col] ?? "";
      const rest = { ...renames };
      delete rest[col];
      setRenames(rest);
      const newName = draft.trim();
      if (!newName || newName === oldName) return;
      if ((scaffoldHeader ?? []).some((item, index) => index !== col && item.trim() === newName)) {
        setError(`字段名「${newName}」已存在`);
        return;
      }
      clearUndo();
      onChangeMarkdown(renameDef(markdown, FIELDS_KEY, oldName, newName));
      setError(null);
      return;
    }
    const draft = renames[col];
    if (draft === undefined) return;
    const rest = { ...renames };
    delete rest[col];
    setRenames(rest);
    const newName = draft.trim();
    const oldName = table.header[col]?.trim() ?? "";
    if (!newName || newName === oldName) return;
    if (table.header.some((item, index) => index !== col && item.trim() === newName)) {
      setError(`字段名「${newName}」已存在`);
      return;
    }
    clearUndo();
    const header = table.header.map((item, index) => (index === col ? newName : item));
    let next = joinDoc(frontText, replaceTable(body, 0, { ...table, header, rows: table.rows }));
    if (fieldDefs[oldName]) next = renameDef(next, FIELDS_KEY, oldName, newName);
    onChangeMarkdown(next);
    setError(null);
  };

  const changeColumnType = (col: number, type: PropertyType) => {
    const name = (table?.header[col] ?? scaffoldHeader?.[col] ?? "").trim();
    if (!name) return;
    clearUndo();
    const existing = fieldDefs[name];
    const def: PropertyDef = {
      type,
      ...(existing?.label ? { label: existing.label } : {}),
      ...(existing?.options ? { options: existing.options } : {}),
      ...(existing?.optionColors && (type === "select" || type === "multiselect") ? { optionColors: existing.optionColors } : {}),
    };
    // 类型是增强信息：不迁移既有值（FR-TBL-4 精神），仅影响后续编辑控件。
    // 单选/多选留着菜单，方便接着改候选；其余类型选完即关。
    onChangeMarkdown(writeDef(markdown, FIELDS_KEY, name, def));
    if (type !== "select" && type !== "multiselect") setMenuCol(null);
  };

  const setColumnOptions = (col: number, raw: string) => {
    const name = (table?.header[col] ?? scaffoldHeader?.[col] ?? "").trim();
    const existing = fieldDefs[name];
    if (!existing || (existing.type !== "select" && existing.type !== "multiselect")) return;
    clearUndo();
    const options = raw.split("\n").map((item) => item.trim()).filter(Boolean);
    if (options.some((option) => option.includes(","))) {
      setError("候选值不能包含逗号（FR-TBL-6）");
      return;
    }
    setError(null);
    const optionColors = Object.fromEntries(Object.entries(existing.optionColors ?? {}).filter(([option]) => options.includes(option)));
    onChangeMarkdown(writeDef(markdown, FIELDS_KEY, name, {
      type: existing.type, options, ...(Object.keys(optionColors).length ? { optionColors } : {}),
    }));
  };

  const setColumnOptionColor = (col: number, option: string, color: OptionColor | null) => {
    const name = (table?.header[col] ?? scaffoldHeader?.[col] ?? "").trim();
    const existing = fieldDefs[name];
    if (!existing || (existing.type !== "select" && existing.type !== "multiselect")) return;
    clearUndo();
    const optionColors = { ...(existing.optionColors ?? {}) };
    if (color) optionColors[option] = color;
    else delete optionColors[option];
    onChangeMarkdown(writeDef(markdown, FIELDS_KEY, name, {
      type: existing.type,
      ...(existing.label ? { label: existing.label } : {}),
      ...(existing.options ? { options: existing.options } : {}),
      ...(Object.keys(optionColors).length ? { optionColors } : {}),
    }));
  };

  const removeColumn = (col: number) => {
    const header = table?.header ?? scaffoldHeader ?? [];
    const name = header[col]?.trim() ?? "";
    clearUndo();
    if (sortCol === col) setSortCol(null);
    else if (sortCol !== null && sortCol > col) setSortCol(sortCol - 1);
    if (filterCol > col) setFilterCol(filterCol - 1);
    else if (filterCol === col) { setFilterCol(0); setFilterValue(""); }
    setSelectedRows(new Set());
    if (header.length <= 1) {
      // 最后一列：回到脚手架（删表体 + 删定义）
      let next = frontText ? joinDoc(frontText, removeFirstTable(body)) : removeFirstTable(body);
      if (fieldDefs[name]) next = removeDef(next, FIELDS_KEY, name);
      onChangeMarkdown(next);
      setMenuCol(null);
      return;
    }
    if (table) {
      const nextHeader = table.header.filter((_, index) => index !== col);
      const rows = table.rows.map((row) => row.filter((_, index) => index !== col));
      let next = joinDoc(frontText, replaceTable(body, 0, { ...table, header: nextHeader, rows }));
      if (fieldDefs[name]) next = removeDef(next, FIELDS_KEY, name);
      onChangeMarkdown(next);
    } else if (fieldDefs[name]) {
      onChangeMarkdown(removeDef(markdown, FIELDS_KEY, name));
    }
    setMenuCol(null);
  };

  /* ---------- 渲染 ---------- */

  if (!table && !blank) {
    return (
      <div className="mn-tabledoc" aria-label="多维表格">
        <div className="mn-tabledoc-degrade" role="alert">
          <p>表格结构无法解析（需要表头行、`---` 分隔行与行首管道符）。</p>
          <button type="button" className="mn-auth-submit"
            onClick={() => { if (window.confirm("封存当前版本并降级为普通笔记？降级后不可恢复为表格。")) onDegrade(); }}>
            转为普通笔记
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mn-tabledoc" aria-label="多维表格">
      {error && !addingCol && menuCol === null && <p className="mn-tabledoc-error" role="alert">{error}</p>}
      {header.length > 0 && (
        <div className="mn-tabledoc-bar">
          <span className="mn-tabledoc-bar-meta">{header.length} 字段 · {(table?.rows ?? []).length} 行</span>
          <div className="mn-tabledoc-bar-actions">
            {undoLabel && <button type="button" className="mn-textbtn" onClick={undoLastBulkAction} aria-label={`撤销${undoLabel}`}><RotateCcw aria-hidden="true" />撤销{undoLabel}</button>}
            <button type="button" className="mn-textbtn" aria-expanded={filterOpen} onClick={() => setFilterOpen((open) => !open)}><Filter aria-hidden="true" />筛选</button>
            <TableColumnVisibility columns={header} hidden={hiddenColumns} onChange={toggleColumnVisibility} />
            {sortCol !== null && <button type="button" className="mn-textbtn" onClick={clearSort}>清除排序</button>}
            <button type="button" className="mn-textbtn" data-table-add-trigger aria-expanded={addingCol}
              onClick={() => { setAddingCol((open) => !open); setMenuCol(null); setError(null); }}>
              <Plus aria-hidden="true" /> 添加字段
            </button>
            <button type="button" className="mn-textbtn" onClick={onSwitchToNote}>切换为普通笔记</button>
          </div>
        </div>
      )}
      {filterOpen && header.length > 0 && (
        <div className="mn-tabledoc-filter" aria-label="表格筛选">
          <label>字段<select value={filterCol} onChange={(event) => {
            const next = Number(event.target.value);
            setFilterCol(next);
            setFilterValue("");
            setFilterOperator(["number", "date"].includes(fieldAt(next).type) ? "eq" : ["select", "multiselect"].includes(fieldAt(next).type) ? "eq" : "contains");
          }}>
            {header.map((name, index) => <option key={`${name}-${index}`} value={index}>{name}</option>)}
          </select></label>
          {(columnType(filterCol) === "number" || columnType(filterCol) === "date") && (
            <label>条件<select value={filterOperator} onChange={(event) => setFilterOperator(event.target.value)}>
              <option value="eq">等于</option><option value="gt">大于</option><option value="lt">小于</option>
            </select></label>
          )}
          {columnType(filterCol) === "checkbox" ? (
            <label>状态<select value={filterValue} onChange={(event) => setFilterValue(event.target.value)}><option value="">全部</option><option value="true">已勾选</option><option value="false">未勾选</option></select></label>
          ) : ["select", "multiselect"].includes(columnType(filterCol)) && (fieldAt(filterCol).def?.options?.length ?? 0) > 0 ? (
            <label>候选值<select value={filterValue} onChange={(event) => setFilterValue(event.target.value)}><option value="">全部</option>{fieldAt(filterCol).def!.options!.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
          ) : (
            <label>{columnType(filterCol) === "date" ? "日期" : columnType(filterCol) === "number" ? "数值" : "包含"}
              <input type={columnType(filterCol) === "date" ? "date" : columnType(filterCol) === "number" ? "number" : "search"}
                value={filterValue} onChange={(event) => setFilterValue(event.target.value)} placeholder="筛选值" />
            </label>
          )}
          <span className="mn-tabledoc-filter-count">{visibleRows.length} / {(table?.rows ?? []).length} 行</span>
          {filterValue && <button type="button" className="mn-auth-link" onClick={() => setFilterValue("")}>清除</button>}
        </div>
      )}
      {activeSelection.size > 0 && (
        <div className="mn-tabledoc-selection" role="toolbar" aria-label="所选行操作">
          <span>已选 {activeSelection.size} 行</span>
          <button type="button" className="mn-textbtn" onClick={() => void copySelectedRows()}><Copy aria-hidden="true" />复制行</button>
          <button type="button" className="mn-textbtn" onClick={deleteSelectedRows}><Trash2 aria-hidden="true" />删除行</button>
          <span className="mn-tabledoc-selection-hint">拖动任一已选行手柄可批量重排</span>
        </div>
      )}
      {header.length === 0 && !addingCol ? (
        <div className="mn-tabledoc-scaffold">
          <p>空白表格文档：从添加第一个字段开始（字段定义存 YAML `fields:`，内容为标准 Markdown 表格）。</p>
          <div className="mn-tabledoc-scaffold-actions">
            <button type="button" className="mn-auth-submit" data-table-add-trigger aria-expanded={addingCol}
              onClick={() => { setAddingCol(true); setError(null); }}>
              <Plus size={14} aria-hidden="true" /> 添加字段
            </button>
            <button type="button" className="mn-auth-link" onClick={onSwitchToNote}>切换为普通笔记</button>
          </div>
        </div>
      ) : (
        <div className="mn-tabledoc-workspace">
        <div className="mn-tabledoc-main">
        <div className="mn-tabledoc-scroll">
      <div className="mn-tabledoc-grid" role="grid" onPaste={pasteGrid} onKeyDown={handleGridKeyDown}>
            <div className="mn-tabledoc-row head" role="row">
              <div className="mn-tabledoc-rownum" role="columnheader" aria-label="选择行">
                <input type="checkbox" aria-label="选择当前可见行" checked={visibleRows.length > 0 && visibleRows.every(({ rowIndex }) => selectedRows.has(rowIndex))}
                  onChange={(event) => selectVisibleRows(event.target.checked)} />
              </div>
              {visibleColumnIndices.map((col) => {
                const name = header[col]!;
                return (
                <ColumnHeaderCell
                  key={col}
                  name={name}
                  index={col}
                  dragging={draggingColumn === col}
                  onColumnDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-menote-column", String(col)); setDraggingColumn(col); }}
                  onTouchColumnDragStart={(event) => {
                    if (event.pointerType !== "touch") return;
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    touchColumnDrag.current = { source: col, target: col, after: false };
                    setDraggingColumn(col);
                  }}
                  onColumnDragEnd={() => setDraggingColumn(null)}
                  onColumnDrop={(event) => {
                    if (!event.dataTransfer.types.includes("application/x-menote-column")) return;
                    const from = Number(event.dataTransfer.getData("application/x-menote-column"));
                    if (Number.isInteger(from)) {
                      event.preventDefault(); event.stopPropagation();
                      const bounds = event.currentTarget.getBoundingClientRect();
                      reorderColumn(from, col, event.clientX >= bounds.left + bounds.width / 2);
                    }
                  }}
                  draft={renames[col]}
                  type={columnType(col)}
                  def={fieldDefs[name.trim()]}
                  optionColors={fieldDefs[name.trim()]?.optionColors ?? {}}
                  sortDirection={sortCol === col ? sortDirection : null}
                  widthLevel={columnWidths[col] ?? 0}
                  onSort={() => toggleSort(col)}
                  onResizeStart={(event) => { resizeRef.current = { col, startX: event.clientX, startLevel: columnWidths[col] ?? 0 }; }}
                  onResize={(level) => updateColumnWidth(col, level)}
                  menuOpen={menuCol === col}
                  error={menuCol === col ? error : null}
                  onDraft={(value) => setRenames((prev) => ({ ...prev, [col]: value }))}
                  onCommit={() => commitRename(col)}
                  onToggle={() => { setAddingCol(false); setMenuCol(menuCol === col ? null : col); }}
                  onClose={() => setMenuCol(null)}
                  onPick={(picked) => changeColumnType(col, picked)}
                  onOptions={(raw) => setColumnOptions(col, raw)}
                  onColor={(option, color) => setColumnOptionColor(col, option, color)}
                  onDelete={() => { if (window.confirm(`删除字段「${name}」及其所有单元格内容？`)) removeColumn(col); }}
                />
                );
              })}
              {addingCol && (
                <AddColumnForm
                  onConfirm={addColumn}
                  onCancel={() => setAddingCol(false)}
                  onEdit={() => setError(null)}
                  taken={header.map((item) => item.trim())}
                  error={error}
                />
              )}
            </div>
            {visibleRows.map(({ cells, rowIndex: row }) => (
              <div className={`mn-tabledoc-row${draggingRow === row ? " dragging" : ""}`} role="row" key={row} data-row-index={row}
                onDragEnd={() => setDraggingRow(null)}
                onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
                onDrop={(event) => { event.preventDefault(); if (draggingRow !== null) {
                  if (activeSelection.has(draggingRow) && activeSelection.size > 1) moveSelectedRows(row);
                  else moveRow(draggingRow, row);
                } setDraggingRow(null); }}>
                <div className="mn-tabledoc-rownum" role="rowheader">
                  <input type="checkbox" aria-label={`选择第 ${row + 1} 行`} checked={selectedRows.has(row)} onChange={(event) => toggleRowSelection(row, event.target.checked)} />
                  <button type="button" className="mn-tabledoc-drag" aria-label={`拖动第 ${row + 1} 行调整顺序`} title="拖动调整行顺序" draggable
                    onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(row)); setDraggingRow(row); if (!selectedRows.has(row)) setSelectedRows(new Set([row])); }}
                    onPointerDown={(event) => {
                      if (event.pointerType !== "touch") return;
                      event.preventDefault();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      touchDrag.current = { source: row, target: row, rows: activeSelection.has(row) ? [...activeSelection] : [row] };
                      setDraggingRow(row);
                    }}
                    onClick={(event) => event.stopPropagation()}>⠿</button>
                  <button type="button" className="mn-tabledoc-row-open" aria-label={`查看第 ${row + 1} 行详情`} title="查看详情" onClick={() => setDetailRow(row)}>{row + 1}</button>
                  <button type="button" className="mn-tabledoc-rowdel" aria-label={`删除第 ${row + 1} 行`} onClick={() => removeRow(row)}><Trash2 aria-hidden="true" /></button>
                </div>
                {visibleColumnIndices.map((col) => {
                  const name = header[col]!;
                  return (
                  <div className={`mn-tabledoc-cell mn-tabledoc-colw-${columnWidths[col] ?? 0}`} role="gridcell" key={col} data-row-index={row} data-col-index={col}>
                    <TableCellEditor
                      value={cells[col] ?? ""} type={columnType(col)} def={fieldDefs[name.trim()]}
                      onChange={(value) => setCell(row, col, value)}
                    />
                  </div>
                  );
                })}
                {addingCol && <AddColumnSpacer />}
              </div>
            ))}
            <div className="mn-tabledoc-row foot" role="row">
              <div className="mn-tabledoc-rownum" role="presentation" />
                {visibleColumnIndices.map((col) => <div className={`mn-tabledoc-cell ghost mn-tabledoc-colw-${columnWidths[col] ?? 0}`} role="presentation" key={col} />)}
              {addingCol && <AddColumnSpacer />}
            </div>
          </div>
          {header.length > 0 && (
            <div className="mn-tabledoc-actions">
              <button type="button" className="mn-auth-link" onClick={addRow}>
                <Plus size={14} aria-hidden="true" /> 添加行
              </button>
            </div>
          )}
        </div>
        </div>
        {detailRow !== null && table?.rows[detailRow] && (
          <TableRowDetailsPanel rowNumber={detailRow + 1} columns={table.header} cells={table.rows[detailRow]} onClose={() => setDetailRow(null)} />
        )}
        </div>
      )}
    </div>
  );
}

/** 已有字段的表头：名称就地改，类型菜单挂到该列下方（portal，不被滚动容器裁切）。 */
function ColumnHeaderCell({ name, index, dragging, onColumnDragStart, onTouchColumnDragStart, onColumnDragEnd, onColumnDrop, draft, type, def, optionColors, menuOpen, error, sortDirection, widthLevel, onSort, onResizeStart, onResize, onDraft, onCommit, onToggle, onClose, onPick, onOptions, onColor, onDelete }: {
  name: string;
  index: number;
  dragging: boolean;
  onColumnDragStart: (event: ReactDragEvent<HTMLButtonElement>) => void;
  onTouchColumnDragStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onColumnDragEnd: () => void;
  onColumnDrop: (event: ReactDragEvent<HTMLDivElement>) => void;
  draft: string | undefined;
  type: PropertyType;
  def: PropertyDef | undefined;
  optionColors: Record<string, OptionColor>;
  menuOpen: boolean;
  error: string | null;
  sortDirection: "asc" | "desc" | null;
  widthLevel: number;
  onSort: () => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResize: (level: number) => void;
  onDraft: (value: string) => void;
  onCommit: () => void;
  onToggle: () => void;
  onClose: () => void;
  onPick: (type: PropertyType) => void;
  onOptions: (raw: string) => void;
  onColor: (option: string, color: OptionColor | null) => void;
  onDelete: () => void;
}) {
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const options = (def?.options ?? []).join("\n");
  return (
    <div className={`mn-tabledoc-hcell mn-tabledoc-colw-${widthLevel}${dragging ? " dragging" : ""}`} role="columnheader" ref={setAnchor} data-column-index={index}
      onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-menote-column")) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }} onDrop={onColumnDrop}>
      <button type="button" className="mn-tabledoc-col-drag" aria-label={`拖动第 ${index + 1} 列调整顺序`} title="拖动调整列顺序" draggable onPointerDown={onTouchColumnDragStart} onDragStart={onColumnDragStart} onDragEnd={onColumnDragEnd}><GripVertical aria-hidden="true" /></button>
      <button type="button" className={`mn-tabledoc-sort${sortDirection ? " active" : ""}`} aria-label={`按${name}排序${sortDirection ? `，当前${sortDirection === "asc" ? "升序" : "降序"}` : ""}`}
        title={sortDirection === "asc" ? "升序（再次点击降序）" : sortDirection === "desc" ? "降序（再次点击升序）" : "排序"} onClick={onSort}>
        {sortDirection === "desc" ? <ArrowDown aria-hidden="true" /> : sortDirection === "asc" ? <ArrowUp aria-hidden="true" /> : <ArrowUpDown aria-hidden="true" />}
      </button>
      <input
        className="mn-tabledoc-hname" value={draft ?? name} aria-label={`字段名（${name}）`}
        onChange={(event) => onDraft(event.target.value)}
        onBlur={onCommit}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
      />
      <button type="button" className="mn-tabledoc-hbadge" aria-label={`字段类型：${FIELD_TYPE_LABELS[type]}`}
        aria-expanded={menuOpen} onClick={onToggle}>
        {FIELD_TYPE_LABELS[type]}
      </button>
      <button type="button" className="mn-tabledoc-colresize" aria-label={`调整${name}列宽`} title="拖动调整列宽"
        onPointerDown={(event) => { event.preventDefault(); onResizeStart(event); }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const direction = event.key === "ArrowRight" ? 1 : -1;
          const next = Math.max(0, Math.min(7, widthLevel + direction));
          onResize(next);
        }} />
      {menuOpen && anchor && (
        <AnchoredPanel className="mn-tabledoc-hmenu" anchor={anchor} label={`字段类型：${name}`} layoutKey={`${type}:${options}:${JSON.stringify(optionColors)}:${error ?? ""}`} onClose={onClose}>
          {error && <p className="mn-tabledoc-error" role="alert">{error}</p>}
          <FieldTypeMenu value={def?.type ?? type} onPick={onPick} />
          {def && (def.type === "select" || def.type === "multiselect") && (
            <>
              <label className="mn-tabledoc-optedit">
                候选值（每行一个，禁含逗号）
                <textarea rows={4} value={options} onChange={(event) => onOptions(event.target.value)} />
              </label>
              {(def.options ?? []).length > 0 && (
                <div className="mn-tabledoc-colors">
                  <span className="mn-tabledoc-colors-title">候选值颜色</span>
                  {(def.options ?? []).map((option, index) => (
                    <div className="mn-tabledoc-color-row" key={`${option}-${index}`}>
                      <span className="mn-tcell-pill" data-tone={optionColors[option] ?? "neutral"}>{option}</span>
                      <div className="mn-tabledoc-color-palette" role="group" aria-label={`${option} 的颜色`}>
                        {OPTION_COLORS.map((color) => (
                          <button key={color} type="button" className="mn-tabledoc-colorswatch"
                            data-tone={color} aria-label={`${option}：${OPTION_COLOR_LABELS[color]}`}
                            aria-pressed={(optionColors[option] ?? "neutral") === color}
                            onClick={() => onColor(option, color === "neutral" ? null : color)} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          <button type="button" className="mn-tabledoc-hdel" onClick={onDelete}>删除字段</button>
        </AnchoredPanel>
      )}
    </div>
  );
}

/** 加字段落在表尾新列：名称在该列表头，类型和确认挂在这一列下面。 */
function AddColumnForm({ onConfirm, onCancel, onEdit, taken, error }: {
  onConfirm: (name: string, type: PropertyType, options?: string[]) => void;
  onCancel: () => void;
  onEdit: () => void;
  taken: string[];
  error: string | null;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyType>("text");
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const duplicate = name.trim() !== "" && taken.includes(name.trim());
  const canAdd = name.trim() !== "" && !duplicate;
  const message = duplicate ? `字段名「${name.trim()}」已存在` : error;
  useEffect(() => {
    anchor?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [anchor]);
  return (
    <>
      <div ref={setAnchor} className="mn-tabledoc-hcell mn-tabledoc-addcol mn-tabledoc-colw-0" role="columnheader">
        <input
          className="mn-tabledoc-hname" value={name} autoFocus aria-label="字段名" placeholder="字段名"
          aria-invalid={duplicate || undefined} autoComplete="off"
          onChange={(event) => { setName(event.target.value); onEdit(); }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && canAdd) onConfirm(name, type);
            if (event.key === "Escape") onCancel();
          }}
        />
      </div>
      {anchor && (
        <AnchoredPanel className="mn-tabledoc-hmenu" anchor={anchor} label="添加字段" layoutKey={`${type}:${message ?? ""}`} onClose={onCancel}>
          {message && <p className="mn-tabledoc-error" role="alert">{message}</p>}
          <FieldTypeMenu value={type} onPick={setType} />
          <div className="mn-tabledoc-addform-actions">
            <button type="button" className="mn-auth-submit" disabled={!canAdd} onClick={() => onConfirm(name, type)}>添加</button>
            <button type="button" className="mn-auth-link" onClick={onCancel}>取消</button>
          </div>
        </AnchoredPanel>
      )}
    </>
  );
}

function AddColumnSpacer() {
  return <div className="mn-tabledoc-cell mn-tabledoc-addcol mn-tabledoc-colw-0" role="presentation" />;
}
