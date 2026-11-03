import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const out = await build({
  entryPoints: [fileURLToPath(new URL("../../shared/src/itemId.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "neutral",
});
const { resolveItemId } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

function encode(id) {
  const hex = id.replace(/-/g, "");
  let binary = "";
  for (let index = 0; index < hex.length; index += 2) binary += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16));
  return Buffer.from(binary, "binary").toString("base64url");
}

test("resolveItemId restores /n/ short ids and leaves other ids untouched", () => {
  const id = "018f6b2a-7c3e-7a11-8b22-9c0d1e2f3a4b";
  const short = encode(id);
  assert.equal(short.length, 22);
  assert.equal(resolveItemId(id), id);
  assert.equal(resolveItemId(short), id);
  assert.equal(resolveItemId(`https://menote.example/n/${short}`), id);
  assert.equal(resolveItemId(`/n/${short}?from=copy`), id);
  assert.equal(resolveItemId("t1"), "t1");
  assert.equal(resolveItemId("  "), "");
});
