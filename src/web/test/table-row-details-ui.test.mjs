import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<div id='root'></div>", { url: "https://menote.test", pretendToBeVisual: true });
for (const key of ["window", "document", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "CustomEvent", "Event", "KeyboardEvent"]) {
  globalThis[key] = dom.window[key];
}
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.MessageChannel = class { port1 = { onmessage: null }; port2 = { postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0) } };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

const bundle = await build({
  stdin: {
    contents: `export { createElement, act } from "react";
      export { createRoot } from "react-dom/client";
      export { TableDocument } from "./src/features/table/TableDocument";
      export { localDb } from "./src/db/localDb";`,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { createElement, act, createRoot, TableDocument, localDb } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

after(() => {
  localDb.close();
  dom.window.close();
});

const original = "| 标题 | 标签 |\n| --- | --- |\n| D | 展示 |\n| B | 隐藏 |\n| A | 展示 |\n| C | 展示 |";
const button = (label) => document.querySelector(`button[aria-label="${label}"]`);
const rowDetails = () => document.querySelector(".mn-tabledoc-detail");
const currentHeading = () => rowDetails()?.querySelector("h2").textContent;
const position = () => rowDetails()?.querySelector(".mn-tabledoc-detail-position [aria-hidden]").textContent;
const press = (element, key) => element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

test("行详情按排序和筛选后的顺序浏览，保留网格滚动和打开行的焦点", async () => {
  let markdown = original;
  const root = createRoot(document.getElementById("root"));
  const render = (readOnly = false) => root.render(createElement(TableDocument, {
    userId: "table-details-user", itemId: "table-details-note", markdown, readOnly,
    onChangeMarkdown: (next) => { markdown = next; render(); },
    onDegrade: () => {}, onSwitchToNote: () => {},
  }));
  const setFilter = (value) => {
    const input = document.querySelector("input[placeholder='筛选值']");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  try {
    await act(async () => render());
    await act(async () => button("字段设置：标题").click());
    const ascending = [...document.querySelectorAll("button")].find(element => element.textContent === "升序排列");
    await act(async () => ascending.click());
    assert.equal(document.querySelector('[data-column-index="0"]').getAttribute("aria-sort"), "ascending");
    assert.match(markdown, /\| A \| 展示 \|\n\| B \| 隐藏 \|\n\| C \| 展示 \|/);
    await act(async () => [...document.querySelectorAll("button")].find((element) => element.textContent === "筛选").click());
    await act(async () => {
      const column = document.querySelector("[aria-label='表格筛选'] select");
      column.value = "1";
      column.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => setFilter("展示"));
    assert.equal(button("查看第 2 行详情"), null);
    const grid = document.querySelector(".mn-tabledoc-scroll");
    grid.scrollTop = 150;
    const opener = button("查看第 1 行详情");
    await act(async () => { opener.focus(); opener.click(); });
    const panel = rowDetails();
    assert.equal(currentHeading(), "第 1 行");
    assert.equal(position(), "1 / 3");
    assert.equal(button("上一行").getAttribute("aria-disabled"), "true");
    await act(async () => button("上一行").click());
    assert.equal(currentHeading(), "第 1 行");

    panel.scrollTop = 80;
    const next = button("下一行");
    await act(async () => { next.focus(); next.click(); });
    assert.equal(rowDetails(), panel);
    assert.equal(currentHeading(), "第 3 行");
    assert.equal(panel.scrollTop, 0);
    assert.equal(grid.scrollTop, 150);
    await act(async () => press(next, "ArrowRight"));
    assert.equal(currentHeading(), "第 4 行");
    assert.equal(button("下一行").getAttribute("aria-disabled"), "true");
    assert.equal(document.activeElement, next);
    await act(async () => press(next, "ArrowRight"));
    assert.equal(currentHeading(), "第 4 行");
    await act(async () => press(next, "ArrowLeft"));
    assert.equal(position(), "2 / 3");

    await act(async () => press(next, "Escape"));
    assert.equal(rowDetails(), null);
    assert.equal(document.activeElement, opener);
    assert.equal(grid.scrollTop, 150);

    await act(async () => opener.click());
    await act(async () => setFilter("隐藏"));
    assert.equal(rowDetails(), null);
    await act(async () => setFilter("展示"));
    assert.equal(rowDetails(), null);

    await act(async () => button("查看第 3 行详情").click());
    await act(async () => render(true));
    assert.equal(button("上一行").getAttribute("aria-disabled"), "false");
    assert.equal(rowDetails().querySelector(".mn-tabledoc-detail-del"), null);
    await act(async () => {
      markdown = markdown.replace("| C | 展示 |\n", "");
      render();
    });
    assert.equal(rowDetails(), null);
    assert.equal(markdown.includes("| D | 展示 |"), true);

    await act(async () => button("查看第 1 行详情").click());
    await act(async () => button("下一行").click());
    await act(async () => rowDetails().querySelector(".mn-tabledoc-detail-del").click());
    assert.equal(rowDetails(), null);
    assert.equal(markdown.includes("| A | 展示 |"), true);
    assert.equal(markdown.includes("| D | 展示 |"), false);
  } finally {
    await act(async () => root.unmount());
  }
});

test("收藏封面在表格中显示图片、回退到链接并保留原有编辑路径", async () => {
  const cover = "https://images.example/cover?size=small";
  const newCover = "https://images.example/another";
  const page = "https://example.com/article";
  let markdown = [
    "---", "fields:", "  封面: { type: attachment }", "  网址: { type: link }", "  cover: { type: link }", "---", "",
    "| 标题 | 封面 | cover | 网址 |",
    "| --- | --- | --- | --- |",
    "| 收藏一 | " + cover + " | " + cover + " | " + page + " |",
    "| 收藏二 | " + cover + " · [资料.pdf](attachments/" + "a".repeat(64) + "--资料.pdf) | javascript:void(0) |  |",
    "| 收藏三 |  |  |  |",
  ].join("\n");
  const originalMarkdown = markdown;
  const root = createRoot(document.getElementById("root"));
  const render = (readOnly = false, sealedAttachments = false) => root.render(createElement(TableDocument, {
    userId: "table-cover-user", itemId: "table-cover-note", markdown, readOnly, sealedAttachments,
    onChangeMarkdown: (next) => { markdown = next; render(); },
    onDegrade: () => {}, onSwitchToNote: () => {},
  }));
  const cell = (row, col) => document.querySelector('[data-row-index="' + row + '"][data-col-index="' + col + '"]');
  const image = (col = 1) => cell(0, col).querySelector("img");
  const updateInput = (input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  try {
    await act(async () => render());
    assert.equal(image().src, cover);
    assert.equal(image().getAttribute("loading"), "lazy");
    assert.equal(image().getAttribute("referrerpolicy"), "no-referrer");
    assert.equal(image().closest("a").href, cover);
    assert.ok(cell(0, 1).querySelector("button[aria-label='上传附件']"));
    assert.equal(image(2).src, cover);
    assert.equal(image(3), null);
    assert.equal(cell(1, 1).querySelector("img"), null);
    assert.equal(cell(1, 1).querySelector("a[download]").download, "资料.pdf");
    assert.ok(cell(1, 1).querySelector("button[aria-label='上传附件']"));
    assert.ok(cell(2, 1).querySelector("button[aria-label='上传附件']"));
    assert.equal(cell(1, 2).querySelector("a"), null);
    assert.equal(markdown, originalMarkdown);

    await act(async () => image().dispatchEvent(new Event("error")));
    assert.equal(image(), null);
    assert.equal(cell(0, 1).querySelector("[aria-label='打开封面链接']").href, cover);

    await act(async () => cell(0, 2).querySelector("button").click());
    const input = cell(0, 2).querySelector("input");
    assert.equal(document.activeElement, input);
    await act(async () => updateInput(input, "https://"));
    assert.equal(document.activeElement, input);
    await act(async () => updateInput(input, newCover));
    assert.equal(document.activeElement, input);
    await act(async () => press(input, "Escape"));
    assert.equal(markdown, originalMarkdown);
    assert.equal(image(2).src, cover);

    await act(async () => cell(0, 2).querySelector("button").click());
    await act(async () => {
      const editor = cell(0, 2).querySelector("input");
      updateInput(editor, newCover);
      press(editor, "Tab");
    });
    assert.equal(document.activeElement, cell(0, 3).querySelector("input"));
    assert.equal(image(2).src, newCover);
    assert.ok(markdown.includes("| 收藏一 | " + cover + " | " + newCover + " | " + page + " |"));

    await act(async () => render(true));
    assert.equal(image().src, cover);
    assert.equal(image(2).src, newCover);
    assert.equal(cell(0, 1).querySelector("button,input"), null);
    await act(async () => image().dispatchEvent(new Event("error")));
    assert.equal(cell(0, 1).querySelector("[aria-label='打开封面链接']").href, cover);
    await act(async () => render(true, true));
    assert.equal(image(), null);
    assert.equal(cell(0, 1).textContent, cover);
    assert.equal(image(2), null);
    assert.equal(cell(0, 2).querySelector("a.mn-tcell-link").href, newCover);
  } finally {
    await act(async () => root.unmount());
  }
});
