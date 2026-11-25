import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
    contents: `
      import { unified } from "unified";
      import remarkParse from "remark-parse";
      import remarkGfm from "remark-gfm";
      import remarkMath from "remark-math";
      import { remarkNoteUnderline } from "./src/lib/noteUnderline";
      import { remarkObsidianSyntax } from "./src/lib/obsidianMarkdown";
      import { remarkObsidianPreview } from "./src/lib/obsidianPreview";
      export { obsidianExcerpt, readObsidianInlineTags } from "./src/lib/obsidianMarkdown";
      export { buildObsidianReferences, obsidianNoteTarget } from "./src/services/obsidianReferenceService";
      export { parseText } from "./src/features/editor/roundtrip";
      export function preview(markdown) {
        const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath)
          .use(remarkNoteUnderline, { preview: true }).use(remarkObsidianSyntax).use(remarkObsidianPreview);
        return parser.runSync(parser.parse(markdown), markdown);
      }
    `,
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(process.cwd() + "/package.json");' },
});
const { preview, obsidianExcerpt, parseText, readObsidianInlineTags, buildObsidianReferences, obsidianNoteTarget } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("Obsidian 预览处理高亮、调用块、公式、脚注与内部引用，隐藏注释", () => {
  const tree = preview([
    "==🟢**高亮**== [[目标#标题|名称]] %%隐藏行内注释%%",
    "%%隐藏多段",
    "注释内容%%",
    "> [!tip]- 展开",
    "> 正文",
    "$x^2$ 与脚注^[注释]",
    "![[目标#^block]]",
  ].join("\n\n").replace("\n\n> 正文", "\n> 正文"));
  const visible = JSON.stringify(tree);
  assert.match(visible, /"hName":"mark"/);
  assert.match(visible, /"dataHighlightColor":"green"/);
  assert.match(visible, /"hName":"details"/);
  assert.match(visible, /"type":"inlineMath"/);
  assert.match(visible, /"type":"footnoteDefinition"/);
  assert.match(visible, /"dataObsidianHeading":"标题"/);
  assert.match(visible, /"dataObsidianBlock":"block"/);
  assert.doesNotMatch(visible, /隐藏行内注释|隐藏多段|注释内容%%/);
});

test("段落 ID、整块 ID 和嵌套标题提取正确范围", () => {
  const markdown = "# 第一章\n\n## 小节\n\n段落 ^p1\n\n- 项目一\n- 项目二\n\n^list\n\n# 第二章\n\n## 小节\n\n另一章节";
  assert.equal(obsidianExcerpt(markdown, { blockId: "p1" }), "段落 ^p1");
  assert.equal(obsidianExcerpt(markdown, { blockId: "list" }), "- 项目一\n- 项目二");
  assert.equal(obsidianExcerpt(markdown, { heading: "第二章#小节" }), "## 小节\n\n另一章节");
  assert.equal(obsidianExcerpt(markdown, { blockId: "absent" }), null);
  assert.match(JSON.stringify(preview(markdown)), /"id":"obsidian-heading-第二章#小节"/);
});

test("下划线只接受约定的 HTML，现有标题、分隔线、转义和代码保留", () => {
  const tree = preview([
    "标题\n==",
    "---",
    '<u style="text-decoration-style:wavy">波浪</u> <u style="text-decoration-style:double">双横</u>',
    '<u onclick="bad()" style="text-decoration-style:wavy">原文</u>',
    "\\==字面量\\== 与 `==代码==`",
  ].join("\n\n"));
  const serialized = JSON.stringify(tree);
  assert.equal(tree.children[0].type, "heading");
  assert.equal(tree.children[1].type, "thematicBreak");
  assert.equal(tree.children[2].children.filter((node) => node.type === "noteUnderline").length, 2);
  assert.equal(tree.children[3].children[0].type, "html");
  assert.doesNotMatch(serialized, /"hName":"mark"/);
});

test("保存保真比较能区分别名相同的引用与相同文字的不同下划线", () => {
  assert.notEqual(parseText("[[甲|同名]]").units[0].key, parseText("[[乙|同名]]").units[0].key);
  assert.notEqual(parseText('<u style="text-decoration-style:wavy">文字</u>').units[0].key,
    parseText('<u style="text-decoration-style:double">文字</u>').units[0].key);
  assert.equal(parseText("==🟢**高亮**==").units[0].key, parseText("**==🟢高亮==**").units[0].key);
});

test("正文标签可筛选且跳过代码、注释和纯数字标签", () => {
  const source = "# 标题\n\n#项目/子项。 #Another #1984 `#code` \\#escaped %% #comment %%\n\n```\n#fenced\n```";
  assert.deepEqual(readObsidianInlineTags(source), ["项目/子项", "Another"]);
  assert.match(JSON.stringify(preview(source)), /"dataObsidianTag":"项目\/子项"/);
});

test("别名候选生成标题链接，优先真实标题并隔离私有、加密和重名条目", () => {
  const note = (id, title, aliases, patch = {}) => ({ id, title, type: "note", deletedAt: null, topicId: null, groupId: null,
    content: { scope: "plain", markdown: `---\naliases: ${JSON.stringify(aliases)}\n---` }, ...patch });
  const { targets, choices } = buildObsidianReferences([
    note("a", "甲", ["旧名", "乙", "共享"]), note("b", "乙", ["共享"]),
    note("c", "私人", ["私密"], { topicId: "vault" }), note("d", "加密", [], { content: { scope: "self", ciphertext: "sealed" } }),
  ], [{ id: "vault", isEncSpace: true, deletedAt: null, parentId: null, name: "Vault" }]);
  assert.equal(obsidianNoteTarget(targets, "旧名"), "a");
  assert.equal(obsidianNoteTarget(targets, "乙"), "b");
  assert.equal(obsidianNoteTarget(targets, "共享"), null);
  assert.equal(obsidianNoteTarget(targets, "私密"), null);
  assert.deepEqual(choices.find((choice) => choice.label === "旧名"), { id: "a:旧名", path: "甲", label: "旧名" });
  assert.equal(choices.some((choice) => choice.label === "加密"), false);
});
