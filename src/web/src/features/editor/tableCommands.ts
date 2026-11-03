/**
 * 表格块操作（FR-EDT-9 / TP4 · W2）。
 *
 * 范围：只管 **Note 正文里的 GFM 表格块**。TP2 的 `type: "table"` 整页表格是另一种内容形态，
 * 不在本模块（TP4 设计 §3 已把它的入口从 Note 文档栏撤下）。
 *
 * **为什么自己实现行列增删**：Milkdown 的 gfm 预设把表格拆成两种行节点——
 * `table_header_row`（表头）与 `table_row`（数据行），且表头行只接受 `table_header` 子节点。
 * prosemirror-tables 的 `addRowBefore/After` 是按「引用行」复制节点类型与内容的，
 * 插到表头附近就会产出 `table_header` 塞进 `table_row`（或反之）的非法结构。
 * Milkdown 自己的 `addRowWithAlignment` 也是绕开这一点：新增行一律用数据行 + 数据单元格。
 * 这里照同样的思路直接对真实节点结构操作，行为可预期，也不依赖选区。
 *
 * 纯逻辑模块：不碰 DOM、不引入 React。
 */
import { TextSelection } from "@milkdown/kit/prose/state";
import type { Node } from "@milkdown/kit/prose/model";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";

/** 单元格对齐：null = 默认（无对齐标记）。 */
export type TableAlign = "left" | "center" | "right" | null;

export type TableCommandId =
  | "row-above"
  | "row-below"
  | "row-delete"
  | "col-left"
  | "col-right"
  | "col-delete"
  | "align-left"
  | "align-center"
  | "align-right"
  | "align-default"
  | "clear-format";

/** 表格上下文：给工具条显示当前行列与对齐状态。 */
export interface TableContext {
  /** 行序号：0 是表头行。 */
  rowIndex: number;
  /** 列序号。 */
  colIndex: number;
  /** 总行数（含表头）。 */
  rowCount: number;
  /** 总列数。 */
  colCount: number;
  /** 每一列当前的对齐。 */
  align: TableAlign[];
  /** 表头行上方插不了行（表头必须留在最前）。 */
  canInsertRowAbove: boolean;
  /** 只剩一行数据时不能删行。 */
  canDeleteRow: boolean;
  /** 只剩一列时不能删列。 */
  canDeleteColumn: boolean;
}

/** 单元格在文档中的定位结果。 */
export interface TableLocation {
  /** 表格节点在文档中的位置。 */
  tablePos: number;
  /** 单元格内容起始位置（可解析成单元格内部）。 */
  cellPos: number;
  /** 行序号：0 是表头行。 */
  rowIndex: number;
  /** 列序号。 */
  colIndex: number;
  context: TableContext;
}

/** Milkdown gfm 预设里的表格节点名。 */
const TABLE = "table";
const HEADER_ROW = "table_header_row";
const ROW = "table_row";
const HEADER_CELL = "table_header";
const CELL = "table_cell";

function cellAlignment(cell: Node): TableAlign {
  const value = cell.attrs.alignment;
  return value === "left" || value === "center" || value === "right" ? value : null;
}

/** 表头行给出的每一列对齐（Markdown 序列化只看表头行）。 */
function columnAligns(header: Node | undefined): TableAlign[] {
  const align: TableAlign[] = [];
  header?.forEach((cell: Node) => align.push(cellAlignment(cell)));
  return align;
}

/** 表格的所有行节点。 */
function rowsOf(table: Node): Node[] {
  const rows: Node[] = [];
  table.forEach((row) => rows.push(row));
  return rows;
}

/** 某个行节点里第 index 个子节点的起始偏移。 */
function offsetOfChild(row: Node, index: number): number {
  let offset = 0;
  for (let i = 0; i < index; i += 1) offset += row.child(i).nodeSize;
  return offset;
}

/**
 * 从任意表格**内部**位置向上找到表格，并算出行列号。
 * 不在表格里（或结构不认识）返回 null。
 *
 * 深度口径：`$pos.index(d)` 给的是**深度 d+1** 那个节点在其父节点中的序号。
 * 表格在深度 tableDepth，则行号取 `index(tableDepth)`、列号取 `index(tableDepth + 1)`。
 */
export function locateTable(doc: Node, pos: number): TableLocation | null {
  const $pos = doc.resolve(pos);
  let tableDepth = -1;
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name === TABLE) {
      tableDepth = depth;
      break;
    }
  }
  if (tableDepth < 1) return null;
  const table = $pos.node(tableDepth);
  const rows = rowsOf(table);
  const header = rows[0];
  const rowIndex = $pos.index(tableDepth);
  const colIndex = $pos.index(tableDepth + 1);
  const align = columnAligns(header);
  const context: TableContext = {
    rowIndex,
    colIndex,
    rowCount: rows.length,
    colCount: header?.childCount ?? 0,
    align,
    canInsertRowAbove: rowIndex > 0,
    canDeleteRow: rowIndex > 0 && rows.length > 2,
    canDeleteColumn: (header?.childCount ?? 0) > 1,
  };
  return {
    tablePos: $pos.before(tableDepth),
    cellPos: $pos.pos,
    rowIndex,
    colIndex,
    context,
  };
}

/** 第 rowIndex 行在文档中的起始位置。 */
function rowStartAt(tablePos: number, rows: Node[], rowIndex: number): number {
  let pos = tablePos + 1;
  for (let i = 0; i < rowIndex; i += 1) pos += rows[i]!.nodeSize;
  return pos;
}

/** 设置某列所有单元格的对齐（表头行 + 数据行）。 */
function setColumnAlign(state: EditorState, tablePos: number, colIndex: number, align: TableAlign): Transaction | null {
  const table = state.doc.nodeAt(tablePos);
  if (!table) return null;
  const tr = state.tr;
  let rowPos = tablePos + 1;
  let touched = false;
  table.forEach((row) => {
    const cell = row.child(colIndex);
    if (cell) {
      const pos = rowPos + 1 + offsetOfChild(row, colIndex);
      tr.setNodeMarkup(pos, undefined, { ...cell.attrs, alignment: align });
      touched = true;
    }
    rowPos += row.nodeSize;
  });
  return touched ? tr : null;
}

/** 清除本表格式：对齐归默认、固定列宽清空。 */
function clearTableFormat(state: EditorState, tablePos: number): Transaction | null {
  const table = state.doc.nodeAt(tablePos);
  if (!table) return null;
  const tr = state.tr;
  let rowPos = tablePos + 1;
  let touched = false;
  table.forEach((row) => {
    // forEach 的第二个参数是子节点在行内容里的**偏移量**，正好是节点位置所差的量。
    row.forEach((cell, offset) => {
      const pos = rowPos + 1 + offset;
      tr.setNodeMarkup(pos, undefined, { ...cell.attrs, alignment: null, colwidth: null });
      touched = true;
    });
    rowPos += row.nodeSize;
  });
  return touched ? tr : null;
}

/**
 * 插入一行数据行。
 * - 表头行只能往下插（表头必须留在最前），往上插直接拒绝。
 * - 新行的单元格对齐沿用各列当前对齐。
 */
function insertRow(state: EditorState, tablePos: number, rowIndex: number, after: boolean): Transaction | null {
  const table = state.doc.nodeAt(tablePos);
  if (!table) return null;
  const rows = rowsOf(table);
  const header = rows[0];
  if (!header) return null;
  if (rowIndex === 0 && !after) return null;
  const align = columnAligns(header);
  const cellType = state.schema.nodes[CELL];
  const rowType = state.schema.nodes[ROW];
  if (!cellType || !rowType) return null;
  const cells: Node[] = [];
  for (const value of align) {
    const cell = cellType.createAndFill({ alignment: value });
    if (!cell) return null;
    cells.push(cell);
  }
  const newRow = rowType.create(null, cells);
  const pos = rowIndex === 0
    ? tablePos + 1 + header.nodeSize
    : rowStartAt(tablePos, rows, rowIndex) + (after ? rows[rowIndex]!.nodeSize : 0);
  const tr = state.tr.insert(pos, newRow);
  // 光标落到新行第一个单元格，插入后可以接着打字。
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 2)));
  return tr;
}

/** 删除一行数据行。表头行不可删，只剩一行数据时也不删（表格结构要求至少一行数据）。 */
function deleteRow(state: EditorState, tablePos: number, rowIndex: number): Transaction | null {
  const table = state.doc.nodeAt(tablePos);
  if (!table) return null;
  const rows = rowsOf(table);
  if (rowIndex <= 0 || rows.length <= 2) return null;
  const start = rowStartAt(tablePos, rows, rowIndex);
  const end = start + rows[rowIndex]!.nodeSize;
  return state.tr.delete(start, end);
}

/**
 * 插入一列：表头行插 `table_header`，数据行插 `table_cell`。
 * 新列的对齐沿用参考列（当前列）的对齐。
 */
function insertColumn(state: EditorState, tablePos: number, colIndex: number, after: boolean): Transaction | null {
  const table = state.doc.nodeAt(tablePos);
  if (!table) return null;
  const rows = rowsOf(table);
  const header = rows[0];
  if (!header) return null;
  const align = columnAligns(header);
  const newIndex = after ? colIndex + 1 : colIndex;
  const alignment = align[colIndex] ?? null;
  const tr = state.tr;
  // 从后往前插：前面的行位置不受影响。
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]!;
    const type = state.schema.nodes[row.type.name === HEADER_ROW ? HEADER_CELL : CELL];
    if (!type) return null;
    const cell = type.createAndFill({ alignment });
    if (!cell) return null;
    const rowStart = rowStartAt(tablePos, rows, i);
    const pos = rowStart + 1 + offsetOfChild(row, Math.min(newIndex, row.childCount));
    tr.insert(pos, cell);
  }
  return tr;
}

/** 删除一列。只剩一列时拒绝（表格至少要有一列）。 */
function deleteColumn(state: EditorState, tablePos: number, colIndex: number): Transaction | null {
  const table = state.doc.nodeAt(tablePos);
  if (!table) return null;
  const rows = rowsOf(table);
  if ((rows[0]?.childCount ?? 0) <= 1) return null;
  const tr = state.tr;
  // 从后往前删：前面的行位置不受影响。
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]!;
    const cell = row.child(colIndex);
    if (!cell) continue;
    const start = rowStartAt(tablePos, rows, i) + 1 + offsetOfChild(row, colIndex);
    tr.delete(start, start + cell.nodeSize);
  }
  return tr;
}

/**
 * 对指定单元格所在的表格执行命令。
 * @param cellPos 单元格内部任意位置（用于定位表格与行列）。
 * @returns 可直接 dispatch 的事务；命令不适用时返回 null。
 */
export function runTableCommand(state: EditorState, command: TableCommandId, cellPos: number): Transaction | null {
  const located = locateTable(state.doc, cellPos);
  if (!located) return null;
  const { tablePos, rowIndex, colIndex } = located;

  switch (command) {
    case "align-left": return setColumnAlign(state, tablePos, colIndex, "left");
    case "align-center": return setColumnAlign(state, tablePos, colIndex, "center");
    case "align-right": return setColumnAlign(state, tablePos, colIndex, "right");
    case "align-default": return setColumnAlign(state, tablePos, colIndex, null);
    case "clear-format": return clearTableFormat(state, tablePos);
    case "row-above": return insertRow(state, tablePos, rowIndex, false);
    case "row-below": return insertRow(state, tablePos, rowIndex, true);
    case "row-delete": return deleteRow(state, tablePos, rowIndex);
    case "col-left": return insertColumn(state, tablePos, colIndex, false);
    case "col-right": return insertColumn(state, tablePos, colIndex, true);
    case "col-delete": return deleteColumn(state, tablePos, colIndex);
    default: return null;
  }
}
