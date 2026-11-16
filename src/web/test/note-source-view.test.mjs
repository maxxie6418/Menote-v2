import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (relative) => readFile(new URL(relative, `file://${webRoot.replace(/\\/g, "/")}`), "utf8");

/** 文档「查看源码」要按正常显示区域铺开（不再是 12rem 小框里滚动）：
 *  标记在文档根节点的 data-editor 上，铺开靠 doc.css 的源码态规则。 */
test("文档根节点带编辑器形态标记", async () => {
  const source = await read("src/features/notes/NoteDocument.tsx");
  assert.match(source, /data-editor=\{isTableDoc \? undefined : editorKind\}/, "NoteDocument 应把编辑器形态写到 data-editor");
});

test("源码态样式把源码区铺满文档区", async () => {
  const css = await read("src/styles/doc.css");
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  assert.match(rules, /\.mn-doc\[data-form="note"\]\[data-mode="edit"\]\[data-editor="source"\] \.mn-doc-main \{[^}]*display: flex;[^}]*flex-direction: column;/, "源码态的纸面应是列向 flex");
  assert.match(rules, /\.mn-doc\[data-form="note"\]\[data-mode="edit"\]\[data-editor="source"\] \.mn-doc-main \{[^}]*align-self: stretch;/, "源码态的纸面应撑满文档区行高");
  assert.match(rules, /\.mn-doc\[data-form="note"\]\[data-mode="edit"\]\[data-editor="source"\] \.mn-editor-host \{[^}]*flex: 1 1 auto;/, "编辑器宿主应吃掉余下高度");
  assert.match(rules, /\.mn-doc\[data-form="note"\]\[data-mode="edit"\]\[data-editor="source"\] \.mn-doc-main > \.mn-editor-wrap \{[^}]*flex: 1 1 auto;/, "编辑器外层应吃掉余下高度");
});
