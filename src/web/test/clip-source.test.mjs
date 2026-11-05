import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/clipSource.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "neutral",
});
const { clipSourceFromMarkdown } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("clip frontmatter exposes the original page", () => {
  const markdown = `---\npage_title: "示例"\nsource_url: "https://example.com/a"\n---\n\n正文`;
  assert.deepEqual(clipSourceFromMarkdown(markdown), { url: "https://example.com/a", host: "example.com" });
  assert.equal(clipSourceFromMarkdown("没有头"), null);
  assert.equal(clipSourceFromMarkdown("---\nsource_url: javascript:alert(1)\n---\n"), null);
});
