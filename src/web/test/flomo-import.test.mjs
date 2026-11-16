import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { zipSync, strToU8 } from "fflate";
import { JSDOM } from "jsdom";

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;
// 解析器用原生 DOMParser 解析导出 HTML；Node 没有，补一个 jsdom 实现。
globalThis.DOMParser = new JSDOM("").window.DOMParser;

// 附件上传走 XMLHttpRequest；测试里用桩件返回固定哈希，验证正文引用与引用计数。
const uploadedShas = [];
class FakeXhr {
  constructor() { this.status = 0; this.responseText = ""; this.upload = {}; }
  open() {}
  setRequestHeader() {}
  send(file) {
    const sha = `${String(file.name).length}`.padStart(2, "0").repeat(32).slice(0, 64);
    uploadedShas.push(sha);
    this.status = 200;
    this.responseText = JSON.stringify({ sha256: sha });
    setTimeout(() => this.onload?.(), 0);
  }
}
globalThis.XMLHttpRequest = FakeXhr;

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/services/flomoImportService.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const service = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const dbBundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/db/localDb.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const dbModule = await import(`data:text/javascript;base64,${Buffer.from(dbBundle.outputFiles[0].text).toString("base64")}`);

const USER = "user-a";

function buildZip() {
  const html = `<html><body><div class="memos">
    <div class="memo" data-tags="[&quot;工作&quot;]">
      <div class="time">2025-08-26 22:44:23</div>
      <div class="content"><p>负责的内容最纪要跟踪进度 #工作 </p></div>
      <div class="files"></div>
    </div>
    <div class="memo" data-tags="[]">
      <div class="time">2024-06-17 15:59:03</div>
      <div class="content"><p>一张图</p></div>
      <div class="files"><img src="file/2024-06-17/6645/photo.jpg" alt="memo image" /></div>
    </div>
  </div></body></html>`;
  return zipSync({
    "flomo@tester-20261116/tester的笔记.html": strToU8(html),
    "flomo@tester-20261116/file/2024-06-17/6645/photo.jpg": new Uint8Array([1, 2, 3, 4]),
  });
}

async function resetLocalDb() {
  await Promise.all(dbModule.localDb.tables.map((table) => table.clear()));
}

function zipFile() {
  return new File([buildZip()], "flomo@tester-20261116.zip", { type: "application/zip" });
}

test("导入写入 Memo：保留原始时间、正文保留 #标签、并带来源标签", async () => {
  await resetLocalDb();
  uploadedShas.length = 0;
  const result = await service.importFlomoExport(USER, zipFile());
  assert.equal(result.imported, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.imagesUploaded, 1);

  const items = await dbModule.localDb.items.where("userId").equals(USER).toArray();
  assert.equal(items.length, 2);
  const tagged = items.find((item) => item.tags.includes("工作"));
  assert.ok(tagged);
  assert.equal(tagged.type, "memo");
  assert.equal(tagged.source, "external");
  assert.equal(tagged.createdAt, new Date(2025, 7, 26, 22, 44, 23).getTime());
  assert.match(tagged.content.markdown, /#工作/);
  assert.ok(tagged.tags.includes("flomo"));
  assert.ok(tagged.content.markdown.includes("#flomo"));

  const withImage = items.find((item) => item.attachmentHashes.length > 0);
  assert.ok(withImage);
  assert.equal(withImage.attachmentHashes.length, 1);
  assert.match(withImage.content.markdown, /!\[[^\]]+\]\(attachments\/[0-9a-f]{64}--[^)]+\)/);
});

test("导入条目进入 outbox 等待同步", async () => {
  const rows = await dbModule.localDb.outbox.toArray();
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.entity === "item" && row.action === "upsert" && row.baseRev === 0));
});

test("重复导入同一个包会跳过，不产生重复条目", async () => {
  await resetLocalDb();
  await service.importFlomoExport(USER, zipFile());
  const again = await service.importFlomoExport(USER, zipFile());
  assert.equal(again.imported, 0);
  assert.equal(again.skipped, 2);
  const items = await dbModule.localDb.items.where("userId").equals(USER).toArray();
  assert.equal(items.length, 2);
});
