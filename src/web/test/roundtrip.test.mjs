import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseText, preserveUnchanged, RoundTripGuard } from "../src/features/editor/roundtrip.ts";

/** PoC 证据：14 项语料，其中 8 项会被序列化器规范化改写。 */
const evidence = JSON.parse(await readFile(new URL("../poc/evidence.json", import.meta.url), "utf8"));

test("PoC 的 8 类规范化：结构等价即回填原文", () => {
  const normalized = evidence.filter((item) => item.source !== item.output);
  assert.ok(normalized.length >= 8, `期望至少 8 项规范化语料，实际 ${normalized.length}`);
  for (const item of normalized) {
    const result = preserveUnchanged(parseText(item.source), item.output);
    assert.equal(result.text, item.source, `${item.name} 未回填原文`);
  }
});

test("PoC 中本来就一致的语料保持不变", () => {
  for (const item of evidence.filter((entry) => entry.source === entry.output)) {
    const result = preserveUnchanged(parseText(item.source), item.output);
    assert.equal(result.text, item.source, `${item.name} 被改动`);
  }
});

test("用户改动所在块用新文本，未触碰块保留原文", () => {
  const source = "# 标题\n\n* 第一项\n* 第二项\n\n结尾段落。\n";
  const next = "# 标题\n\n* 第一项\n* 第二项改\n\n结尾段落。\n";
  const result = preserveUnchanged(parseText(source), next);
  assert.ok(result.text.includes("* 第二项改"));
  assert.ok(result.text.includes("# 标题"));
  assert.ok(result.text.includes("结尾段落。"));
  // 未触碰的列表项仍是原文的星号写法（新文本同样是星号，这里断言原文风格保留）
  assert.equal(result.preserved >= 2, true);
});

test("改一处不影响其他块的原始字节（列表符号风格保留）", () => {
  const source = "- 甲\n- 乙\n\n段落。\n";
  // 序列化器把无序列表换成星号，并改了段落（模拟用户编辑）
  const next = "* 甲\n* 乙\n\n段落改。\n";
  const result = preserveUnchanged(parseText(source), next);
  assert.ok(result.text.startsWith("- 甲\n- 乙"), `列表原文未保留：${JSON.stringify(result.text)}`);
  assert.ok(result.text.includes("段落改。"));
});

test("表格分隔行与单元格填充被改写时回填原文", () => {
  const source = "| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |\n";
  const next = "| 名称 | 数量 |\n| -- | -- |\n| 苹果 | 3  |\n";
  const result = preserveUnchanged(parseText(source), next);
  assert.equal(result.text, source);
});

test("改列对齐时分隔行用新写法，表体仍保留原文", () => {
  const source = "| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |\n";
  // 工具条把第二列设为居中：分隔行变成 `:-:`，表体没动。
  const next = "| 名称 | 数量 |\n| --- | :-: |\n| 苹果 | 3 |\n";
  const result = preserveUnchanged(parseText(source), next);
  assert.ok(result.text.includes(":-:"), `新对齐应保留：${JSON.stringify(result.text)}`);
  assert.ok(result.text.includes("| 苹果 | 3 |"), `表体应保留原文：${JSON.stringify(result.text)}`);
});

test("任务列表勾选状态变化会被识别为改动", () => {
  const source = "- [ ] 未完成\n";
  const next = "- [x] 未完成\n";
  const result = preserveUnchanged(parseText(source), next);
  assert.ok(result.text.includes("[x]"), "勾选状态应被采用新文本");
});

test("插入新段落只影响插入处，前后原文保留", () => {
  const source = "第一段。\n\n第三段。\n";
  const next = "第一段。\n\n新插入段。\n\n第三段。\n";
  const result = preserveUnchanged(parseText(source), next);
  assert.ok(result.text.includes("第一段。"));
  assert.ok(result.text.includes("新插入段。"));
  assert.ok(result.text.includes("第三段。"));
});

test("守卫连续更新：基线随保留结果前进", () => {
  const guard = new RoundTripGuard("- 甲\n- 乙\n");
  const first = guard.update("* 甲\n* 乙\n");
  assert.equal(first.text, "- 甲\n- 乙\n", "第一次回填应恢复原文");
  const second = guard.update("* 甲改\n* 乙\n");
  assert.ok(second.text.includes("甲改"), "改过的块用新文本");
  assert.ok(second.text.includes("- 乙"), "未触碰的块保留原文");
});

test("reset 之后不再保留旧内容", () => {
  const guard = new RoundTripGuard("- 甲\n");
  guard.reset("* 全新\n");
  const result = guard.update("* 全新\n");
  assert.equal(result.text, "* 全新\n");
});

test("空文档与清空都能处理", () => {
  const result = preserveUnchanged(parseText("正文。\n"), "");
  assert.equal(result.text, "");
});

test("有序列表插入一项不会写错序号（整块重排，不逐项回填）", () => {
  const source = "1. 甲\n2. 乙\n";
  const next = "1. 新\n2. 甲\n3. 乙\n";
  const result = preserveUnchanged(parseText(source), next);
  // 要么整块用新文本（序号正确），要么原样——绝不能出现 1,1,2 这类错位
  assert.equal(result.text === next || result.text === source, true, `序号错位：${JSON.stringify(result.text)}`);
  assert.ok(/1\.\s*新/.test(result.text), `序号错位：${JSON.stringify(result.text)}`);
  assert.ok(/2\.\s*甲/.test(result.text), `序号错位：${JSON.stringify(result.text)}`);
  assert.ok(/3\.\s*乙/.test(result.text), `序号错位：${JSON.stringify(result.text)}`);
});

test("表格插入数据行不会让分隔行错位", () => {
  const source = "| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |\n";
  const next = "| 名称 | 数量 |\n| -- | -- |\n| 新 | 1 |\n| 苹果 | 3 |\n";
  const result = preserveUnchanged(parseText(source), next);
  const separators = result.text.split("\n").filter((line) => /^\|[\s|:-]+\|$/.test(line.trim()));
  assert.equal(separators.length, 1, `分隔行应只有一行：${JSON.stringify(result.text)}`);
  assert.ok(result.text.startsWith("| 名称 | 数量 |"), "表头应在最前");
  assert.ok(result.text.includes("| 新 | 1 |"), "新行应保留");
  assert.ok(result.text.includes("| 苹果 | 3 |"), "原行应保留");
});
