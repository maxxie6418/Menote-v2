import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/markdownTasks.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const tasks = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("setTaskCheckbox flips only the ordinal task line (FR-MEMO-3)", () => {
  const source = ["- [ ] 买咖啡", "正文一行", "* [x] 已完成的事", "1. [ ] 编号任务"].join("\n");
  const checked = tasks.setTaskCheckbox(source, 0, true);
  assert.match(checked, /- \[x\] 买咖啡/);
  assert.match(checked, /\* \[x\] 已完成的事/);
  assert.match(checked, /1\. \[ \] 编号任务/);
  const unchecked = tasks.setTaskCheckbox(checked, 1, false);
  assert.match(unchecked, /\* \[ \] 已完成的事/);
  assert.equal(tasks.countTaskCheckboxes(unchecked), 3);
});

test("out-of-range ordinal returns the source untouched", () => {
  const source = "- [ ] 只有一个";
  assert.equal(tasks.setTaskCheckbox(source, 5, true), source);
});

test("quoted and nested task lines are recognized", () => {
  const nested = ["> - [ ] 引用里的任务", "  - [ ] 缩进任务"].join("\n");
  const next = tasks.setTaskCheckbox(nested, 1, true);
  assert.match(next, /  - \[x\] 缩进任务/);
  assert.match(next, /> - \[ \] 引用里的任务/);
});
