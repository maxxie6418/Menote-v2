import assert from "node:assert/strict";
import test from "node:test";
import { applyBlock, applySlash, insertAttachment, slashContext, toggleInline } from "../src/features/editor/markdownEdit.ts";

test("行内加粗：无选区插入空标记，光标在中间", () => {
  const result = toggleInline("你好", 2, 2, "bold");
  assert.equal(result.markdown, "你好****");
  assert.equal(result.selectionStart, 4);
});

test("行内加粗：有选区包裹，再来一次取消", () => {
  const once = toggleInline("你好世界", 2, 4, "bold");
  assert.equal(once.markdown, "你好**世界**");
  const twice = toggleInline(once.markdown, once.selectionStart, once.selectionEnd, "bold");
  assert.equal(twice.markdown, "你好世界");
});

test("斜杠只在行首触发", () => {
  assert.equal(slashContext("正文 /不是", 6), null);
  const hit = slashContext("段落\n/表", 6);
  assert.deepEqual(hit, { from: 3, query: "表" });
});

test("斜杠执行后删掉触发文字再插入", () => {
  const slash = slashContext("/代码", 3);
  const result = applySlash("/代码", slash, 3, "codeblock");
  assert.equal(result.markdown.startsWith("```"), true);
  assert.equal(result.markdown.includes("/代码"), false);
});

test("附件插在光标处，不追加到文末", () => {
  const result = insertAttachment("甲乙丙", 1, { name: "a.png", sha256: "f".repeat(64) }, true);
  assert.ok(result.markdown.startsWith("甲"));
  assert.ok(result.markdown.includes(`![a.png](attachments/${"f".repeat(64)}--a.png)`));
  assert.ok(result.markdown.endsWith("丙"));
});

test("标题再点一次去掉前缀", () => {
  const once = applyBlock("正文", 2, "heading2");
  assert.equal(once.markdown, "## 正文");
  const twice = applyBlock(once.markdown, once.selectionStart, "heading2");
  assert.equal(twice.markdown, "正文");
});
