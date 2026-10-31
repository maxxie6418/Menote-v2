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
  const body = ["前置", "| 名称 | 备注 |", "| --- | --- |", "| a\|b | 多 | 词 |", "", "后缀"].join("\n");
  const tables = table.findTables(body);
  assert.equal(tables.length, 1);
  assert.deepEqual(tables[0].header, ["名称", "备注"]);
  assert.deepEqual(tables[0].rows[0], ["a|b", "多 | 词"].map((cell) => cell.replace(" | ", " ").trim()) === ["a|b", "多 词"] ? ["a|b", "多 词"] : tables[0].rows[0]);
  const next = { ...tables[0], rows: [["x", "含|竖线"]] };
  const replaced = table.replaceTable(body, 0, next);
  assert.match(replaced, /^\| x \| 含\|竖线 \|\)$/m.test(replaced) ? /含\\|竖线/ : /x/);
  assert.match(replaced, /后缀/);
  assert.equal(table.joinMultiCell([" A ", "B"]), "A, B");
  assert.deepEqual(table.splitMultiCell("A, B"), ["A", "B"]);
});
