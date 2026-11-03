// 顶层块切分与渐进渲染阈值（FR-EDT-10 / TP4 · W3c）。
import assert from "node:assert/strict";
import test from "node:test";
import {
  batchCount,
  FIRST_BATCH_CHARS,
  LIGHTWEIGHT_CHARS,
  needsLightweightMode,
  needsProgressiveRender,
  PROGRESSIVE_CHARS,
  splitTopLevelBlocks,
} from "../src/lib/markdownBlocks.ts";

test("按顶层块切分：拼回去与原文一致", () => {
  const source = "# 标题\n\n第一段。\n\n第二段。\n";
  const chunks = splitTopLevelBlocks(source);
  assert.equal(chunks.length, 3);
  assert.equal(chunks.map((chunk) => chunk.text).join(""), source);
});

test("松散列表不会被空行拆开（列表内部有空行仍是一个块）", () => {
  const source = "- 甲\n\n- 乙\n\n段落。\n";
  const chunks = splitTopLevelBlocks(source);
  assert.equal(chunks.length, 2, `列表应是一个块：${JSON.stringify(chunks.map((c) => c.text))}`);
  assert.ok(chunks[0].text.startsWith("- 甲"));
  assert.ok(chunks[0].text.includes("- 乙"));
  assert.ok(chunks[1].text.startsWith("段落。"));
});

test("围栏代码块整体保留", () => {
  const source = "```js\nconst a = 1;\n\nconst b = 2;\n```\n\n后面。\n";
  const chunks = splitTopLevelBlocks(source);
  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].text.includes("const b = 2;"));
  assert.equal(chunks.map((chunk) => chunk.text).join(""), source);
});

test("表格整体是一个块", () => {
  const source = "| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |\n\n段落。\n";
  const chunks = splitTopLevelBlocks(source);
  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].text.includes("| 苹果 | 3 |"));
});

test("任务列表项序号按块累计", () => {
  // 列表之间要有非列表块才切得开（同一个列表里的空行不会切开列表）。
  const source = "- [ ] 甲\n- [x] 乙\n\n段落。\n\n- [ ] 丙\n";
  const chunks = splitTopLevelBlocks(source);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].taskBase, 0);
  assert.equal(chunks[1].taskBase, 2, "段落块之前应累计两个任务项");
  assert.equal(chunks[2].taskBase, 2);
});

test("空文档切出零块", () => {
  assert.deepEqual(splitTopLevelBlocks(""), []);
  assert.deepEqual(splitTopLevelBlocks("\n\n  \n"), []);
});

test("阈值判定：短文不进渐进模式，超长文进轻量模式", () => {
  assert.equal(needsProgressiveRender("短文", 3), false);
  assert.equal(needsProgressiveRender("a".repeat(PROGRESSIVE_CHARS + 1), 3), true);
  assert.equal(needsProgressiveRender("短文", 3001), true);
  assert.equal(needsLightweightMode("a".repeat(LIGHTWEIGHT_CHARS + 1)), true);
  assert.equal(needsLightweightMode("a".repeat(LIGHTWEIGHT_CHARS)), false);
  // 轻量模式优先于渐进模式：两者不同时开。
  assert.equal(needsProgressiveRender("a".repeat(LIGHTWEIGHT_CHARS + 1), 4000), false);
});

test("分批：至少一批，且按字符预算推进", () => {
  const chunks = splitTopLevelBlocks("甲\n\n乙\n\n丙\n\n丁\n");
  assert.equal(batchCount(chunks, 0, FIRST_BATCH_CHARS), chunks.length, "首屏预算足够时一次取完");
  assert.equal(batchCount(chunks, 0, 1), 1, "预算很小也要有进展");
  assert.equal(batchCount(chunks, 2, 1), 1);
  assert.equal(batchCount(chunks, chunks.length, 100), 1, "没有剩余时也不应返回 0（避免空转）");
});
