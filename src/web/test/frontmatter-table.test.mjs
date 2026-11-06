import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const fmBundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/frontmatter.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const fm = await import(`data:text/javascript;base64,${Buffer.from(fmBundle.outputFiles[0].text).toString("base64")}`);
const tableBundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/gfmTable.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const table = await import(`data:text/javascript;base64,${Buffer.from(tableBundle.outputFiles[0].text).toString("base64")}`);

test("frontmatter round-trip preserves untouched keys verbatim (FR-PROP-7)", () => {
  const source = `---\ntitle: 笔记\n'quoted key': "保持 原样 # 引号"\n# 注释也保留\nstatus: high\n---\n\n# 正文\n`;
  const next = fm.writeValue(source, "status", "low");
  assert.match(next, /'quoted key': "保持 原样 # 引号"/);
  assert.match(next, /# 注释也保留/);
  assert.match(next, /status: low/);
  assert.match(next, /# 正文/);
  const twice = fm.writeValue(next, "status", null);
  assert.equal(fm.parseFrontmatterData(twice).status, undefined);
  assert.match(twice, /'quoted key': "保持 原样 # 引号"/);
});

test("reserved namespaces props/fields carry type definitions (开放项 #5)", () => {
  let markdown = "正文";
  markdown = fm.writeDef(markdown, fm.PROPS_KEY, "due", { type: "date", label: "截止日" });
  markdown = fm.writeDef(markdown, fm.PROPS_KEY, "tags2", { type: "multiselect", options: ["工作", "生活"] });
  const defs = fm.readDefs(markdown, fm.PROPS_KEY);
  assert.equal(defs.due.type, "date");
  assert.equal(defs.due.label, "截止日");
  assert.deepEqual(defs.tags2.options, ["工作", "生活"]);
  const rows = fm.readPropRows(fm.writeValue(markdown, "due", "2026-11-01"), fm.PROPS_KEY);
  assert.deepEqual(rows.find((row) => row.key === "due").raw, "2026-11-01");
});

test("confirmed AI summary is a labeled 概述 property and keeps the body", () => {
  const next = fm.writeSummaryProperty("# 正文\n\n段落", "两句话的概述。");
  const row = fm.readPropRows(next, fm.PROPS_KEY).find((entry) => entry.key === "summary");
  assert.equal(row.raw, "两句话的概述。");
  assert.equal(row.def.type, "multiline");
  assert.equal(row.def.label, "概述");
  assert.match(next, /# 正文/);
});

test("table field definitions do not create property values (FR-TBL-3 / FR-PROP-4)", () => {
  const markdown = fm.writeDef("", fm.FIELDS_KEY, "状态", { type: "select", options: ["待办", "完成"] });
  const data = fm.parseFrontmatterData(markdown);
  assert.equal(data.状态, undefined);
  assert.deepEqual(fm.readDefs(markdown, fm.FIELDS_KEY).状态.options, ["待办", "完成"]);
});

test("unknown scalar types degrade to text; arrays stay native (FR-PROP-6/8)", () => {
  const markdown = `---\nfree: "任意文本"\nnums: [工作, 生活]\nflag: true\nwhen: 2026-11-01\n---\n正文`;
  const rows = fm.readPropRows(markdown, fm.PROPS_KEY);
  const free = rows.find((row) => row.key === "free");
  const nums = rows.find((row) => row.key === "nums");
  const flag = rows.find((row) => row.key === "flag");
  assert.equal(free.raw, "任意文本");
  assert.equal(nums.isArray, true);
  assert.deepEqual(nums.arrayValues, ["工作", "生活"]);
  assert.equal(flag.isBoolean, true);
  assert.equal(rows.find((row) => row.key === "when").raw, "2026-11-01");
});

test("GFM table parse, escape and replace keep the carrier standard (FR-TBL-1/6)", () => {
  const body = ["前置", "| 名称 | 备注 |", "| --- | --- |", "| a\\|b | 多 词 |", "", "后缀"].join("\n");
  const tables = table.findTables(body);
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0].header, ["名称", "备注"]);
  assert.deepEqual(tables[0].rows[0], ["a|b", "多 词"]);
  const next = { ...tables[0], rows: [["x", "含|竖线"]] };
  const replaced = table.replaceTable(body, 0, next);
  assert.match(replaced, /\| x \| 含\\\|竖线 \|/);
  assert.match(replaced, /后缀/);
  assert.equal(table.joinMultiCell([" A ", "B"]), "A, B");
  assert.deepEqual(table.splitMultiCell("A, B"), ["A", "B"]);
  assert.equal(table.normalizeCellValue("  多行\n文本  "), "多行 文本");
  assert.equal(table.normalizeCellValue("  首尾空格  "), "首尾空格");
});

test("GFM table parsing accepts omitted outer pipes (FR-TBL-1)", () => {
  const parsed = table.findTables("名称 | 备注\n--- | ---\n甲 | 第一条");
  assert.equal(parsed.length, 1);
  assert.deepEqual(parsed[0].header, ["名称", "备注"]);
  assert.deepEqual(parsed[0].rows, [["甲", "第一条"]]);
});

test("GFM table parser handles escaped backslash parity around pipes", () => {
  assert.deepEqual(table.splitRow("| a\\\\|b | c |"), ["a\\", "b", "c"]);
  assert.deepEqual(table.splitRow("| a\\\\\\|b | c |"), ["a\\|b", "c"]);
});

test("候选值分隔：换行与中英文分号、逗号都认，空格不作分隔符", () => {
  // 回车换行：每个候选一行
  assert.deepEqual(fm.parseOptionList("待办\n进行中\n已完成"), ["待办", "进行中", "已完成"]);
  // 中英文分号
  assert.deepEqual(fm.parseOptionList("待办；进行中"), ["待办", "进行中"]);
  assert.deepEqual(fm.parseOptionList("待办;进行中"), ["待办", "进行中"]);
  // 既有逗号写法继续认（老数据不失效）
  assert.deepEqual(fm.parseOptionList("待办, 进行中"), ["待办", "进行中"]);
  assert.deepEqual(fm.parseOptionList("待办，进行中"), ["待办", "进行中"]);
  // 空格不作分隔符：值里的空格要留着
  assert.deepEqual(fm.parseOptionList("In Progress, 待评审"), ["In Progress", "待评审"]);
  // 空项与重复项
  assert.deepEqual(fm.parseOptionList("A;;B\n\nA"), ["A", "B"]);
});

test("restoreProp merges only the removed property into the latest markdown", () => {
  let before = fm.writeDef("旧正文", fm.PROPS_KEY, "status", { type: "select", options: ["open", "done"] });
  before = fm.writeValue(before, "status", "open");
  const deleted = fm.removePropDef(before, fm.PROPS_KEY, "status");
  const latest = fm.writeValue(fm.writeValue(deleted, "title", "新标题"), "other", "新属性");
  const restored = fm.restoreProp(latest, before, fm.PROPS_KEY, "status");
  const data = fm.parseFrontmatterData(restored);
  assert.equal(data.status, "open");
  assert.equal(data.title, "新标题");
  assert.equal(data.other, "新属性");
  assert.match(restored, /旧正文/);
  assert.deepEqual(fm.readDefs(restored, fm.PROPS_KEY).status.options, ["open", "done"]);

  const recreated = fm.writeValue(latest, "status", "new");
  assert.equal(fm.parseFrontmatterData(fm.restoreProp(recreated, before, fm.PROPS_KEY, "status")).status, "new");
});

test("renameProp moves value and definition together (FR-PROP-2)", () => {
  let markdown = fm.writeDef("正文", fm.PROPS_KEY, "status", { type: "select", label: "状态", options: ["未开始", "已完成"] });
  markdown = fm.writeValue(markdown, "status", "已完成");
  const next = fm.renameProp(markdown, fm.PROPS_KEY, "status", "state");
  const data = fm.parseFrontmatterData(next);
  assert.equal(data.state, "已完成");
  assert.equal(data.status, undefined);
  const defs = fm.readDefs(next, fm.PROPS_KEY);
  assert.equal(defs.state.label, "状态");
  assert.deepEqual(defs.state.options, ["未开始", "已完成"]);
  assert.equal(defs.status, undefined);
});

test("renameProp keeps arrays/booleans and refuses to overwrite an existing key", () => {
  let markdown = fm.writeValue("正文", "tags", ["材质", "光照"]);
  markdown = fm.writeDef(markdown, fm.PROPS_KEY, "tags", { type: "multiselect", options: ["材质", "光照"] });
  const moved = fm.renameProp(markdown, fm.PROPS_KEY, "tags", "labels");
  assert.deepEqual(fm.parseFrontmatterData(moved).labels, ["材质", "光照"]);
  assert.equal(fm.parseFrontmatterData(moved).tags, undefined);

  // 目标键已存在：原样返回，不吞掉任何一边
  const clash = fm.renameProp(fm.writeValue(markdown, "labels", ["旧"]), fm.PROPS_KEY, "tags", "labels");
  assert.deepEqual(fm.parseFrontmatterData(clash).labels, ["旧"]);
  assert.deepEqual(fm.parseFrontmatterData(clash).tags, ["材质", "光照"]);

  // 源键不存在：不动
  assert.equal(fm.renameProp("正文", fm.PROPS_KEY, "nope", "other"), "正文");
});

test("Note marginalia round-trips in frontmatter without changing properties or body", () => {
  const source = `---\ntitle: 记录\nprops:\n  status:\n    type: text\nstatus: draft\n---\n\n# 保持原文\n正文内容`;
  const annotation = { id: "m-1", quote: "正文", note: "补充一个例子", createdAt: 1793900000000 };
  const written = fm.writeNoteMarginalia(source, [annotation]);
  assert.deepEqual(fm.readNoteMarginalia(written), [annotation]);
  assert.equal(fm.parseFrontmatterData(written).status, "draft");
  assert.deepEqual(fm.readDefs(written, fm.PROPS_KEY).status, { type: "text", label: undefined, options: undefined, optionColors: undefined });
  assert.equal(fm.readPropRows(written, fm.PROPS_KEY).some((row) => row.key === "menote_marginalia"), false);
  assert.match(written, /# 保持原文\n正文内容$/);
  const removed = fm.writeNoteMarginalia(written, []);
  assert.deepEqual(fm.readNoteMarginalia(removed), []);
  assert.equal(fm.parseFrontmatterData(removed).status, "draft");
});
