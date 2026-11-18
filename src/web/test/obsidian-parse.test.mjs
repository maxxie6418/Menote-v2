import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// 解析器依赖 @menote/shared 的运行时导出（node_modules 内不做类型擦除），测试里用 esbuild 打包后导入。
const entry = fileURLToPath(new URL("../src/lib/obsidianParse.ts", import.meta.url));
const resolveDir = fileURLToPath(new URL("../../../node_modules/.pnpm/node_modules/", import.meta.url));
const bundle = await build({ entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "node", nodePaths: [resolveDir] });
const {
  parseObsidianFiles, makeObsidianResolver, finalizeObsidianDraft, countMissingImages,
} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

/** 构造一个最小扫描清单：两篇笔记、两张图片、隐藏目录与无关文件若干。 */
function buildFiles() {
  const file = (name, text = "x") => new File([text], name);
  return [
    { path: "MyVault/.obsidian/app.json", file: file("app.json") },
    { path: "MyVault/.trash/旧笔记.md", file: file("旧笔记.md") },
    { path: "MyVault/日记/2026-11-01.md", file: file("2026-11-01.md") },
    { path: "MyVault/日记/2026-11-02.md", file: file("2026-11-02.md") },
    { path: "MyVault/attachments/照片.png", file: file("照片.png") },
    { path: "MyVault/attachments/图表.webp", file: file("图表.webp") },
    { path: "MyVault/README.pdf", file: file("README.pdf") },
  ];
}

test("分类：md 记为笔记、图片进附件候选、隐藏目录与其它文件跳过并计数", () => {
  const data = parseObsidianFiles(buildFiles(), { rootLabel: "MyVault" });
  assert.equal(data.summary.isVault, true, "存在 .obsidian 即识别为整库");
  assert.equal(data.summary.notes, 2);
  assert.equal(data.summary.images, 2);
  assert.equal(data.summary.skipped, 2, ".trash 里的旧笔记与 README.pdf；.obsidian 配置不计入");
  assert.equal(data.drafts.map((draft) => draft.title).join(","), "2026-11-01,2026-11-02");
});

test("图片引用解析：wiki 嵌入全库按名命中，标准链接按相对路径命中，尺寸参数忽略", async () => {
  const data = parseObsidianFiles(buildFiles(), { rootLabel: "MyVault" });
  const resolve = makeObsidianResolver(data);
  const draft = data.drafts[0];
  draft.file = new File(["正文开头\n![[照片.png|300]]\n![alt 文本](../attachments/图表.webp)\n![[不存在的图.png]]"], draft.file.name);
  const finalized = await finalizeObsidianDraft(draft, resolve);
  assert.equal(finalized.images.length, 3);
  const byTarget = new Map(finalized.images.map((ref) => [ref.target, ref]));
  assert.equal(byTarget.get("照片.png").resolvedPath, "MyVault/attachments/照片.png");
  assert.equal(byTarget.get("照片.png").alt, "照片");
  assert.equal(byTarget.get("../attachments/图表.webp").resolvedPath, "MyVault/attachments/图表.webp");
  assert.equal(byTarget.get("../attachments/图表.webp").alt, "alt 文本");
  assert.equal(byTarget.get("不存在的图.png").resolvedPath, null, "解析不到的引用标记缺失而不是丢弃");
  assert.equal(countMissingImages([finalized]), 1);
});

test("URL 编码与外链：百分号路径可解析，http(s) 与 data: 引用跳过", async () => {
  const files = [
    { path: "V/笔记.md", file: new File(["x"], "笔记.md") },
    { path: "V/imgs/截图 01.png", file: new File(["x"], "截图 01.png") },
  ];
  const data = parseObsidianFiles(files, { rootLabel: "V" });
  const resolve = makeObsidianResolver(data);
  data.drafts[0].file = new File([
    "![外链](https://example.com/a.png)\n![数据](data:image/png;base64,AAAA)\n![编码](imgs/%E6%88%AA%E5%9B%BE%2001.png)",
  ], "笔记.md");
  const finalized = await finalizeObsidianDraft(data.drafts[0], resolve);
  assert.equal(finalized.images.length, 1, "外链与 data: 不参与解析");
  assert.equal(finalized.images[0].resolvedPath, "V/imgs/截图 01.png");
});
