// 表格块操作（FR-EDT-9 / TP4 · W2）单元测试。
// 用与 Milkdown gfm 预设同构的表格 schema（表头行 table_header_row + 数据行 table_row），
// 直接驱动 tableCommands 的纯逻辑，验证行列增删与对齐写回。
import assert from "node:assert/strict";
import test from "node:test";
import { Schema } from "@milkdown/kit/prose/model";
import { EditorState } from "@milkdown/kit/prose/state";
import { locateTable, runTableCommand } from "../src/features/editor/tableCommands.ts";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", toDOM: () => ["p", 0] },
    text: { group: "inline" },
    table: { content: "table_header_row table_row+", group: "block", tableRole: "table", toDOM: () => ["table", 0] },
    table_header_row: { content: "(table_header)*", tableRole: "row", toDOM: () => ["tr", 0] },
    table_row: { content: "(table_cell)*", tableRole: "row", toDOM: () => ["tr", 0] },
    table_header: {
      content: "paragraph",
      attrs: { alignment: { default: null } },
      tableRole: "header_cell",
      toDOM: () => ["th", 0],
    },
    table_cell: {
      content: "paragraph",
      attrs: { alignment: { default: null } },
      tableRole: "cell",
      toDOM: () => ["td", 0],
    },
  },
});

/** 造一张表：首行为表头，其余为数据行。 */
function buildTable(header, rows) {
  const headerCells = header.map((text) =>
    schema.nodes.table_header.create(null, schema.nodes.paragraph.create(null, text ? schema.text(text) : null)));
  const headerRow = schema.nodes.table_header_row.create(null, headerCells);
  const bodyRows = rows.map((cells) =>
    schema.nodes.table_row.create(null, cells.map((text) =>
      schema.nodes.table_cell.create(null, schema.nodes.paragraph.create(null, text ? schema.text(text) : null)))));
  return schema.nodes.table.create(null, [headerRow, ...bodyRows]);
}

function stateWithTable(table) {
  return EditorState.create({ doc: schema.nodes.doc.create(null, [table]) });
}

/** 表格里第 row 行第 col 列单元格的内容起始位置。 */
function cellPos(doc, row, col) {
  let tablePos = -1;
  doc.descendants((node, pos) => {
    if (tablePos < 0 && node.type.name === "table") tablePos = pos;
  });
  const table = doc.nodeAt(tablePos);
  let pos = tablePos + 1;
  for (let i = 0; i < row; i += 1) pos += table.child(i).nodeSize;
  const rowNode = table.child(row);
  pos += 1;
  for (let i = 0; i < col; i += 1) pos += rowNode.child(i).nodeSize;
  return pos + 1;
}

/** 把结果表格摊平成可断言的形状。 */
function shape(doc) {
  let tablePos = -1;
  doc.descendants((node, pos) => {
    if (tablePos < 0 && node.type.name === "table") tablePos = pos;
  });
  const table = doc.nodeAt(tablePos);
  const rows = [];
  table.forEach((row) => {
    const cells = [];
    row.forEach((cell) => {
      cells.push({
        type: cell.type.name,
        alignment: cell.attrs.alignment ?? null,
        text: cell.textContent,
      });
    });
    rows.push(cells);
  });
  return rows;
}

const TABLE = buildTable(["名称", "数量"], [["苹果", "3"], ["香蕉", "12"]]);

test("定位表格：行列号与表头对齐状态", () => {
  const state = stateWithTable(TABLE);
  const located = locateTable(state.doc, cellPos(state.doc, 1, 1));
  assert.ok(located);
  assert.equal(located.rowIndex, 1);
  assert.equal(located.colIndex, 1);
  assert.equal(located.context.rowCount, 3);
  assert.equal(located.context.colCount, 2);
  assert.deepEqual(located.context.align, [null, null]);
});

test("在下方插入行：新行追加在目标行之后且沿用列对齐", () => {
  const state = stateWithTable(TABLE);
  const tr = runTableCommand(state, "row-below", cellPos(state.doc, 1, 0));
  assert.ok(tr);
  const rows = shape(tr.doc);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[1].map((cell) => cell.text), ["苹果", "3"]);
  assert.deepEqual(rows[2].map((cell) => cell.text), ["", ""]);
  assert.equal(rows[2][0].type, "table_cell");
});

test("在上方插入行：新行插在目标行之前", () => {
  const state = stateWithTable(TABLE);
  const tr = runTableCommand(state, "row-above", cellPos(state.doc, 2, 0));
  assert.ok(tr);
  const rows = shape(tr.doc);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[2].map((cell) => cell.text), ["", ""]);
  assert.deepEqual(rows[3].map((cell) => cell.text), ["香蕉", "12"]);
});

test("表头行上方插不了行，表头行下方可以插行", () => {
  const state = stateWithTable(TABLE);
  assert.equal(runTableCommand(state, "row-above", cellPos(state.doc, 0, 0)), null);
  const tr = runTableCommand(state, "row-below", cellPos(state.doc, 0, 0));
  assert.ok(tr);
  const rows = shape(tr.doc);
  assert.equal(rows.length, 4);
  assert.equal(rows[0][0].type, "table_header");
  assert.deepEqual(rows[1].map((cell) => cell.text), ["", ""]);
});

test("删除本行：只删目标数据行，表头保留", () => {
  const state = stateWithTable(TABLE);
  const tr = runTableCommand(state, "row-delete", cellPos(state.doc, 1, 0));
  assert.ok(tr);
  const rows = shape(tr.doc);
  assert.equal(rows.length, 2);
  assert.equal(rows[0][0].type, "table_header");
  assert.deepEqual(rows[1].map((cell) => cell.text), ["香蕉", "12"]);
});

test("表头行不可删，只剩一行数据时也不删", () => {
  const single = buildTable(["名称"], [["苹果"]]);
  const state = stateWithTable(single);
  assert.equal(runTableCommand(state, "row-delete", cellPos(state.doc, 0, 0)), null);
  assert.equal(runTableCommand(state, "row-delete", cellPos(state.doc, 1, 0)), null);
});

test("插入列：表头行插表头单元格，数据行插数据单元格", () => {
  const state = stateWithTable(TABLE);
  const tr = runTableCommand(state, "col-right", cellPos(state.doc, 0, 0));
  assert.ok(tr);
  const rows = shape(tr.doc);
  assert.equal(rows[0].length, 3);
  assert.equal(rows[0][2].type, "table_header");
  assert.equal(rows[1][2].type, "table_cell");
  assert.deepEqual(rows[1].map((cell) => cell.text), ["苹果", "", "3"]);
});

test("删除本列：每行同时少一个单元格", () => {
  const state = stateWithTable(TABLE);
  const tr = runTableCommand(state, "col-delete", cellPos(state.doc, 0, 0));
  assert.ok(tr);
  const rows = shape(tr.doc);
  assert.equal(rows[0].length, 1);
  assert.equal(rows[1].length, 1);
  assert.deepEqual(rows[1].map((cell) => cell.text), ["3"]);
});

test("只剩一列时不能删列", () => {
  const single = buildTable(["名称"], [["苹果"]]);
  const state = stateWithTable(single);
  assert.equal(runTableCommand(state, "col-delete", cellPos(state.doc, 0, 0)), null);
});

test("列对齐写回：表头行与数据行同步", () => {
  const state = stateWithTable(TABLE);
  const tr = runTableCommand(state, "align-center", cellPos(state.doc, 0, 1));
  assert.ok(tr);
  const rows = shape(tr.doc);
  assert.equal(rows[0][1].alignment, "center");
  assert.equal(rows[1][1].alignment, "center");
  assert.equal(rows[2][1].alignment, "center");
  assert.equal(rows[0][0].alignment, null);
});

test("清除对齐回到默认值", () => {
  const state = stateWithTable(TABLE);
  const aligned = runTableCommand(state, "align-right", cellPos(state.doc, 0, 0));
  assert.ok(aligned);
  const cleared = runTableCommand(state.apply(aligned), "align-default", cellPos(aligned.doc, 0, 0));
  assert.ok(cleared);
  const rows = shape(cleared.doc);
  assert.equal(rows[0][0].alignment, null);
  assert.equal(rows[1][0].alignment, null);
});

test("清除本表格式：对齐与列宽一起归零", () => {
  const state = stateWithTable(TABLE);
  const aligned = runTableCommand(state, "align-left", cellPos(state.doc, 0, 0));
  assert.ok(aligned);
  const cleared = runTableCommand(state.apply(aligned), "clear-format", cellPos(aligned.doc, 0, 0));
  assert.ok(cleared);
  const rows = shape(cleared.doc);
  for (const row of rows) {
    for (const cell of row) assert.equal(cell.alignment, null);
  }
});
