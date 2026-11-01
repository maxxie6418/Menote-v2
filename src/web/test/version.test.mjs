import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const result = await build({ entryPoints: [fileURLToPath(new URL("../src/lib/version.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "browser", define: { __APP_VERSION__: '"0.0.1"', __APP_BUILD_COMMIT__: '"abc1234"', __APP_BUILD_TIME__: '"2026-10-31T00:00:00Z"' } });
const version = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

test("version label combines version, commit and build time", () => {
  assert.equal(version.formatVersionLabel("0.0.1", "abc1234", "2026-10-31T00:00:00Z"), "v0.0.1 · 构建 abc1234 · 2026-10-31T00:00:00Z");
});

test("version label falls back to unknown commit and omits empty build time", () => {
  assert.equal(version.formatVersionLabel("0.0.1", "", ""), "v0.0.1 · 构建 unknown");
});

test("module export shows version only (M1.2 侧栏脚部简化)", () => {
  assert.equal(version.APP_VERSION_LABEL, "v0.0.1");
});
