import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const plugin = fileURLToPath(new URL("../src/features/editor/textColorPlugin.ts", import.meta.url));
const textColor = fileURLToPath(new URL("../src/features/editor/textColor.ts", import.meta.url));
const resolveDir = fileURLToPath(new URL("../../../node_modules/.pnpm/node_modules/", import.meta.url));
const bundle = await build({
  stdin: { contents: `import { unified } from "unified"; import parse from "remark-parse"; import stringify from "remark-stringify"; import { remarkTextColorBridge } from ${JSON.stringify(plugin)}; export { applyTextColor } from ${JSON.stringify(textColor)}; export const processor = unified().use(parse).use(stringify).use(remarkTextColorBridge);`, resolveDir, loader: "js" },
  bundle: true, write: false, format: "esm", platform: "node",
  plugins: [{ name: "mock-milkdown", setup(build) { build.onResolve({ filter: /^@milkdown\/kit\/utils$/ }, () => ({ path: "utils", namespace: "mock" })); build.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export const $remark = () => null; export const $markSchema = () => null;" })); } }],
});
const { applyTextColor, processor } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`).catch((error) => { console.error(error.message); process.exit(1); });

test("颜色标记可序列化并重新解析，保留嵌套格式", () => {
  const tree = { type: "root", children: [{ type: "paragraph", children: [
    { type: "textColor", color: "#c2412d", children: [{ type: "strong", children: [{ type: "text", value: "红色" }] }] },
  ] }] };
  const markdown = processor.stringify(tree);
  assert.match(markdown, /<span style="color:#c2412d">\*\*红色\*\*<\/span>/);
  const restored = processor.runSync(processor.parse(markdown));
  assert.equal(restored.children[0].children[0].type, "textColor");
  assert.equal(restored.children[0].children[0].children[0].type, "strong");
});

test("重复应用当前色保留格式，清除颜色后仍选中原文字", () => {
  const text = "这段文字";
  const prefix = '前缀<span style="color:#c2412d">';
  const markdown = `${prefix}${text}</span>后缀`;
  const start = prefix.length;
  const end = start + text.length;
  assert.deepEqual(applyTextColor(markdown, start, end, "#c2412d"), { markdown, start, end });
  const cleared = applyTextColor(markdown, start, end, null);
  assert.equal(cleared.markdown, `前缀${text}后缀`);
  assert.equal(cleared.markdown.slice(cleared.start, cleared.end), text);
});


