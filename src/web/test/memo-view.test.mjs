import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: `export { groupByDay, memoImages, memoSourceLabel, dayLabel } from "./src/features/memo/memoView";`,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { groupByDay, memoImages, memoSourceLabel } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const memo = (id, createdAt, markdown = "正文", tags = []) => ({
  id, userId: "u", type: "memo", topicId: null, groupId: null, title: null, tags,
  status: null, attachmentHashes: [], source: "external", rev: 1, metaRev: 1, contentHash: id,
  pinned: false, starred: false, createdAt, updatedAt: createdAt, deletedAt: null,
  content: { scope: "plain", markdown },
});

/** 跨年同月同日：分组 key 必须唯一（不然 React 报重复 key，条目会被丢）。 */
test("跨年同月同日分成两组，key 互不相同", () => {
  const now = new Date(2026, 10, 16, 12, 0).getTime();
  const groups = groupByDay([
    memo("a", new Date(2020, 7, 26, 10, 0).getTime(), "一"),
    memo("b", new Date(2023, 7, 26, 10, 0).getTime(), "二"),
    memo("c", new Date(2023, 7, 26, 22, 0).getTime(), "三"),
  ], now);
  assert.equal(groups.length, 2, "2020 与 2023 的同一天应是两组");
  assert.equal(groups[0].memos.length, 1);
  assert.equal(groups[1].memos.length, 2, "同一天的两条应在一组");
  const keys = groups.map((group) => group.key);
  assert.equal(new Set(keys).size, keys.length, `分组 key 应唯一：${keys.join(" / ")}`);
});

test("同一天不按先后顺序拆散", () => {
  const groups = groupByDay([
    memo("a", new Date(2024, 2, 1, 23, 0).getTime()),
    memo("b", new Date(2024, 2, 2, 1, 0).getTime()),
    memo("c", new Date(2024, 2, 1, 5, 0).getTime()),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups.find((group) => group.memos.some((m) => m.id === "a"))?.memos.length, 2);
});

/** 图册只收明文 Memo 的图片引用；加密条目整条排除。 */
test("图册图片只来自明文条目", () => {
  const hash = "a".repeat(64);
  const images = memoImages([
    memo("a", 1, `![图](attachments/${hash}--pic.png)`),
    { ...memo("b", 2, `![图](attachments/${hash}--pic.png)`), content: { scope: "encrypted", markdown: "" } },
  ]);
  assert.equal(images.length, 1);
  assert.equal(images[0].memoId, "a");
  assert.equal(images[0].originLabel, "外部导入");
});

test("记录的 Memo 来源区分 Flomo、网页剪藏和 Agent", () => {
  const clip = memo("clip", 1, "> 正文\n\n—— [原网页](https://example.com/path_(1))\n\n#收集");
  assert.equal(memoSourceLabel({ ...clip, source: "clipper" }), "浏览器剪藏 · example.com");
  assert.equal(memoSourceLabel({ ...clip, source: "manual" }), "手动记录");
  assert.equal(memoSourceLabel({ ...clip, source: "agent" }), "Agent 创建");
  assert.equal(memoSourceLabel(memo("flomo", 1, "正文 #flomo", ["flomo"])), "Flomo 导入");
});
