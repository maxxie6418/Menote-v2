import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { zipSync, strToU8 } from "fflate";

// 解析器依赖 @menote/shared 的运行时导出（node_modules 内不做类型擦除），测试里用 esbuild 打包后导入。
const entry = fileURLToPath(new URL("../src/lib/flomoParse.ts", import.meta.url));
const resolveDir = fileURLToPath(new URL("../../../node_modules/.pnpm/node_modules/", import.meta.url));
const bundle = await build({ entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "node", nodePaths: [resolveDir] });
const { applyFlomoImages, parseFlomoExport } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const dom = new JSDOM("", { url: "https://menote.test" });
const createDocument = (html) => new dom.window.DOMParser().parseFromString(html, "text/html");

/** 按 Flomo 官方导出结构搭一个最小包：根目录一层 `flomo@用户-日期/`，里面是笔记 HTML 与 `file/` 附件目录。 */
function buildZip() {
  const html = `<html><body><div class="memos">
    <div class="memo" data-tags="[&quot;工作&quot;]">
      <div class="time">2025-08-26 22:44:23</div>
      <div class="content"><p>负责的内容最纪要跟踪进度 #工作 </p></div>
      <div class="files"></div>
    </div>
    <div class="memo" data-tags="[]">
      <div class="time">2024-06-17 15:59:03</div>
      <div class="content"></div>
      <div class="files">
        <img src="file/2024-06-17/6645/photo.jpg" alt="memo image" />
      </div>
    </div>
    <div class="memo" data-tags="[&quot;收藏&quot;,&quot;鸡汤&quot;]">
      <div class="time">2024-01-26 18:22:14</div>
      <div class="content"><p>#收藏  #鸡汤 一段话</p><p>第二段</p></div>
      <div class="files"></div>
    </div>
  </div></body></html>`;
  return zipSync({
    "flomo@tester-20261116/tester的笔记.html": strToU8(html),
    "flomo@tester-20261116/file/2024-06-17/6645/photo.jpg": new Uint8Array([1, 2, 3, 4]),
  });
}

test("解析导出包：条数、时间、标签、正文与图片都对得上", () => {
  const parsed = parseFlomoExport(buildZip(), createDocument);
  assert.equal(parsed.memos.length, 3);
  assert.equal(parsed.imageCount, 1);
  assert.equal(parsed.missingImages, 0);
  assert.deepEqual([...parsed.tags].sort(), ["工作", "收藏", "鸡汤"].sort());

  const first = parsed.memos[0];
  assert.equal(first.createdAt, new Date(2025, 7, 26, 22, 44, 23).getTime());
  assert.deepEqual(first.tags, ["工作"]);
  assert.match(first.markdown, /#工作/);
  assert.equal(first.images.length, 0);

  const second = parsed.memos[1];
  assert.equal(second.images.length, 1);
  assert.equal(second.images[0].name, "photo.jpg");
  assert.equal(second.images[0].bytes.length, 4);
  assert.match(second.markdown, /\{\{flomo-image:0\}\}/);

  const third = parsed.memos[2];
  assert.deepEqual(third.tags, ["收藏", "鸡汤"]);
  assert.equal(third.markdown.split("\n\n").length, 2);
  assert.match(third.markdown, /#收藏/);
});

test("图片占位符替换成附件引用；上传失败的图片不留断链", () => {
  const parsed = parseFlomoExport(buildZip(), createDocument);
  const markdown = parsed.memos[1].markdown;
  const sha = "a".repeat(64);
  assert.equal(applyFlomoImages(markdown, [{ sha256: sha, name: "photo.jpg" }]), `![photo.jpg](attachments/${sha}--photo.jpg)`);
  assert.equal(applyFlomoImages(markdown, [null]), "");
});

test("纯图片 memo 的正文为空但图片保留；content 为 null 按空正文处理", () => {
  const html = `<html><body><div class="memos">
    <div class="memo" data-tags="[]">
      <div class="time">2021-01-20 22:50:55</div>
      <div class="content">null</div>
      <div class="files"><img src="file/2021-01-20/6645/a.jpg" alt="memo image" /></div>
    </div>
  </div></body></html>`;
  const bytes = zipSync({
    "flomo@tester-20261116/笔记.html": strToU8(html),
    "flomo@tester-20261116/file/2021-01-20/6645/a.jpg": new Uint8Array([9]),
  });
  const parsed = parseFlomoExport(bytes, createDocument);
  assert.equal(parsed.memos.length, 1);
  assert.equal(parsed.memos[0].markdown, "{{flomo-image:0}}");
  assert.equal(parsed.memos[0].images.length, 1);
});

test("包里没有 HTML 时明确报错，不静默产出空结果", () => {
  const bytes = zipSync({ "readme.txt": strToU8("hello") });
  assert.throws(() => parseFlomoExport(bytes, createDocument), /flomo_html_missing/);
});
