// W2 表格块操作验证（FR-EDT-9）：在 jsdom 中用真实 Milkdown 执行命令，检查写回的 markdown。
// 运行：node --test poc/table-check.mjs（在 src/web 下）（不在 pnpm test 套件内，属接入证据）
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { build } from "esbuild";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.Node = dom.window.Node;
globalThis.getSelection = () => dom.window.getSelection();
globalThis.addEventListener = dom.window.addEventListener.bind(dom.window);
globalThis.removeEventListener = dom.window.removeEventListener.bind(dom.window);
globalThis.dispatchEvent = dom.window.dispatchEvent.bind(dom.window);
for (const name of ["Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "InputEvent", "FocusEvent",
  "CompositionEvent", "ClipboardEvent", "UIEvent", "EventTarget", "DocumentFragment"]) {
  globalThis[name] = dom.window[name];
}
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const bundle = await build({
  entryPoints: [new URL("./table-entry.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const harness = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const TABLE = [
  "| 名称 | 数量 |",
  "| --- | --- |",
  "| 苹果 | 3 |",
  "| 香蕉 | 12 |",
  "",
].join("\n");

test("表格上下文：行列与对齐读得出来", async () => {
  const result = await harness.runTableCommand(TABLE, "align-left", 0);
  assert.equal(result.error, undefined, result.error ?? "");
  assert.equal(result.contextBefore.rowCount, 3, "行数应含表头");
  assert.equal(result.contextBefore.colCount, 2);
  assert.equal(result.contextBefore.rowIndex, 0, "第 0 个单元格在表头行");
  assert.equal(result.contextBefore.colIndex, 0);
  assert.deepEqual(result.contextBefore.align, [null, null]);
});

test("在下方插入行：多出一行数据", async () => {
  const result = await harness.runTableCommand(TABLE, "row-below", 2);
  assert.equal(result.error, undefined, result.error ?? "");
  assert.ok(result.markdown.includes("| 香蕉 | 12 |"));
  assert.equal(result.markdown.split("\n").filter((line) => line.startsWith("|")).length, 5, `应为表头+分隔+3 行：${result.markdown}`);
});

test("在上方插入行", async () => {
  const result = await harness.runTableCommand(TABLE, "row-above", 2);
  assert.equal(result.error, undefined, result.error ?? "");
  assert.equal(result.markdown.split("\n").filter((line) => line.startsWith("|")).length, 5);
});

test("删除本行", async () => {
  // cellIndex 4 = 「香蕉」行的第一个单元格（0/1 表头，2/3 苹果行，4/5 香蕉行）
  const result = await harness.runTableCommand(TABLE, "row-delete", 4);
  assert.equal(result.error, undefined, result.error ?? "");
  assert.ok(!result.markdown.includes("香蕉"), `被删的行应消失：${result.markdown}`);
  assert.ok(result.markdown.includes("苹果"));
});

test("删除首行数据：表头保留", async () => {
  const result = await harness.runTableCommand(TABLE, "row-delete", 2);
  assert.equal(result.error, undefined, result.error ?? "");
  assert.ok(!result.markdown.includes("苹果"), `被删的行应消失：${result.markdown}`);
  assert.ok(result.markdown.includes("香蕉"));
  assert.ok(result.markdown.includes("名称"), `表头应保留：${result.markdown}`);
});

test("只剩一行数据时不能删行", async () => {
  const single = ["| 名称 | 数量 |", "| --- | --- |", "| 苹果 | 3 |", ""].join("\n");
  const result = await harness.runTableCommand(single, "row-delete", 2);
  assert.equal(result.error, undefined, result.error ?? "");
  assert.ok(result.markdown.includes("苹果"), `不应删掉唯一一行数据：${result.markdown}`);
});

test("表头行上方插不了行", async () => {
  const result = await harness.runTableCommand(TABLE, "row-above", 0);
  assert.equal(result.error, undefined, result.error ?? "");
  assert.equal(result.markdown.split("\n").filter((line) => line.startsWith("|")).length, 4, `不应新增行：${result.markdown}`);
  assert.ok(result.markdown.startsWith("| 名称 |"), `表头应仍在最前：${result.markdown}`);
});

test("表头行下方可以插行", async () => {
  const result = await harness.runTableCommand(TABLE, "row-below", 0);
  assert.equal(result.error, undefined, result.error ?? "");
  assert.equal(result.markdown.split("\n").filter((line) => line.startsWith("|")).length, 5, `应新增一行：${result.markdown}`);
  assert.ok(result.markdown.startsWith("| 名称 |"), `表头应仍在最前：${result.markdown}`);
});

test("在右侧插入列", async () => {
  const result = await harness.runTableCommand(TABLE, "col-right", 0);
  assert.equal(result.error, undefined, result.error ?? "");
  assert.equal(result.contextAfter?.colCount, 3, `列数应变 3：${result.markdown}`);
});

test("删除本列", async () => {
  const result = await harness.runTableCommand(TABLE, "col-delete", 0);
  assert.equal(result.error, undefined, result.error ?? "");
  assert.equal(result.contextAfter?.colCount, 1, `列数应变 1：${result.markdown}`);
});

test("列对齐写回标准 GFM 记号", async () => {
  const center = await harness.runTableCommand(TABLE, "align-center", 0);
  assert.equal(center.error, undefined, center.error ?? "");
  assert.ok(center.markdown.includes(":-:"), `居中应写回 :-:：${center.markdown}`);
  const right = await harness.runTableCommand(TABLE, "align-right", 1);
  assert.ok(right.markdown.includes("-:"), `右对齐应写回 -:：${right.markdown}`);
  const left = await harness.runTableCommand(TABLE, "align-left", 0);
  assert.ok(left.markdown.includes(":-"), `左对齐应写回 :-：${left.markdown}`);
  const reset = await harness.runTableCommand(TABLE, "align-default", 0);
  assert.ok(!reset.markdown.includes(":-"), `清除对齐应回到无记号：${reset.markdown}`);
});

test("对齐改动也要进持久化文本（不能被回填还原成旧写法）", async () => {
  const center = await harness.runTableCommand(TABLE, "align-center", 0);
  assert.equal(center.error, undefined, center.error ?? "");
  assert.ok(center.preserved.includes(":-:"), `持久化文本应带上居中记号：${center.preserved}`);
});

test("写回仍是标准 GFM 表格（分隔行只有一行、表头在前）", async () => {
  const result = await harness.runTableCommand(TABLE, "col-right", 0);
  const lines = result.markdown.split("\n").filter((line) => line.trim());
  const separators = lines.filter((line) => /^\|[\s|:-]+\|$/.test(line.trim()));
  assert.equal(separators.length, 1, `分隔行应只有一行：${result.markdown}`);
  assert.ok(lines[0].startsWith("| 名称 |"), `表头应在最前：${result.markdown}`);
});

test("改动表格后，未触碰的其他内容不受影响", async () => {
  const source = `前面段落。\n\n${TABLE}\n后面段落。\n`;
  const result = await harness.runTableCommand(source, "row-below", 2);
  assert.equal(result.error, undefined, result.error ?? "");
  assert.ok(result.preserved.includes("前面段落。"), `未触碰段落应保留：${result.preserved}`);
  assert.ok(result.preserved.includes("后面段落。"), `未触碰段落应保留：${result.preserved}`);
});
