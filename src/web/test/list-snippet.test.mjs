import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/features/notes/format.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const fmt = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const plainItem = (type, markdown) => ({
  id: "item-1", type, title: "标题", tags: [], topicId: null, groupId: null,
  content: { scope: "plain", markdown }, createdAt: 0, updatedAt: 0, deletedAt: null,
});

test("清单摘要剥掉 frontmatter，不把属性键泄进列表", () => {
  const item = plainItem("note", `---\npage_title: "批驳 唯物辩证主义"\nstatus: high\n---\n\n# 正文标题\n这是正文第一段。`);
  const snippet = fmt.noteSnippet(item);
  assert.ok(!snippet.includes("page_title"), snippet);
  assert.ok(!snippet.includes("status"), snippet);
  assert.match(snippet, /正文标题/);
  assert.match(snippet, /这是正文第一段/);
});

test("表格摘要为「x 行 x 列」，不显示字段定义", () => {
  const markdown = `---\nfields:\n  名称:\n    type: text\n  地址:\n    type: text\n  重要:\n    type: checkbox\n---\n\n| 名称 | 地址 | 重要 |\n| --- | --- | --- |\n| 甲 | a |  |\n| 乙 | b |  |\n| 丙 | c |  |\n`;
  const snippet = fmt.noteSnippet(plainItem("table", markdown));
  assert.equal(snippet, "3 行 3 列");
  assert.ok(!snippet.includes("fields"), snippet);
  assert.ok(!snippet.includes("type"), snippet);
});

test("表格无 GFM 正文时按字段数兜底；无字段显示空表格", () => {
  assert.equal(fmt.noteSnippet(plainItem("table", "---\nfields:\n  甲:\n    type: text\n  乙:\n    type: text\n---\n")), "0 行 2 列");
  assert.equal(fmt.noteSnippet(plainItem("table", "无任何结构")), "空表格");
});

test("加密条目与随记摘要保持原口径", () => {
  const locked = plainItem("note", "密文不看");
  locked.content = { scope: "keywrapped", ciphertext: "xx" };
  assert.equal(fmt.noteSnippet(locked), "已加密");
  assert.equal(fmt.noteSnippet(plainItem("memo", "# 标题\n**加粗**正文")), "标题 加粗正文");
});
