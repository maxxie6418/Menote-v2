import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const dom = new JSDOM("", { url: "https://menote.test" });
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
const bundle = await build({ entryPoints: [fileURLToPath(new URL("../src/lib/themeSkin.ts", import.meta.url))], bundle: true, write: false, format: "esm" });
let counter = 0;
async function fresh() {
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + `\n// ${counter++}`).toString("base64")}`);
}

test("new users default to shadcn and explicit older skins remain selected", async () => {
  for (const [stored, expected] of [[null, "shadcn"], ["slate", "slate"], ["ink", "ink"], ["paper", "ink"], ["default", "slate"]]) {
    localStorage.clear();
    if (stored !== null) localStorage.setItem("menote.skin", stored);
    const skin = await fresh();
    assert.equal(skin.getThemeSkin(), expected);
    assert.equal(document.documentElement.dataset.skin, expected);
  }
});

test("skin changes persist and apply to the document", async () => {
  localStorage.clear();
  const skin = await fresh();
  skin.setThemeSkin("shadcn");
  assert.equal(localStorage.getItem("menote.skin"), "shadcn");
  skin.setThemeSkin("ink");
  assert.equal(document.documentElement.dataset.skin, "ink");
  assert.equal(localStorage.getItem("menote.skin"), "ink");
});
