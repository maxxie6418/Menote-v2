import { mkdtemp, open, rm } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { crc32 } from "node:zlib";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { collectBackup, writeSnapshotFiles } from "../src/services/backupService.ts";
import { processAccountArchive } from "../src/services/accountArchiveService.ts";
import { newSnapshotId } from "../src/services/backupRemote.ts";
import yauzl from "yauzl";

const MiB = 1024 * 1024;
const archiveLimit = 256 * MiB;
const snapshotFile = /^menote\/(\d{8}T\d{9}Z-[0-9a-f]{8})\/(COMPLETE|manifest\.json|\d{4}-\d{2}\.json|attachment-[0-9a-f]{64})$/;
const templateFile = /^extras\/clip-templates\/[\w.-]+\.json$/;
let busy = false;

async function indexArchive(zip) {
  if (zip.entryCount > 35000) throw new Error("迁移包文件过多");
  const files = new Map();
  const templates = [];
  let id, total = 0, metadata = 0;
  for await (const entry of zip.eachEntry()) {
    const name = entry.fileName;
    if (name.endsWith("/") && entry.uncompressedSize === 0) continue;
    const match = snapshotFile.exec(name);
    const template = templateFile.test(name);
    if ((!match && !template && name !== "extras/raindrop-mapping.json") || files.has(name) ||
        (match && id && id !== match[1]) || entry.isEncrypted()) throw new Error("迁移包目录或格式无效，请选择 Menote 账号迁移 ZIP");
    if (match) id = match[1];
    if (template) templates.push(name);
    total += entry.uncompressedSize;
    if (!match?.[2].startsWith("attachment-")) metadata += entry.uncompressedSize;
    if (entry.uncompressedSize > 32 * MiB || total > 1024 * MiB || metadata > 32 * MiB) throw new Error("迁移包解压大小超过限制");
    files.set(name, entry);
  }
  if (!id || !files.has("menote/" + id + "/COMPLETE")) throw new Error("迁移包缺少账号快照或完成标记");
  async function read(name, expectedSize) {
    const entry = files.get(name);
    if (!entry || (expectedSize !== undefined && expectedSize !== entry.uncompressedSize)) throw new Error("迁移包文件缺失或长度不符");
    const stream = await zip.openReadStreamPromise(entry);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    if (bytes.length !== entry.uncompressedSize || crc32(bytes) !== entry.crc32) throw new Error("迁移包文件校验失败");
    return bytes;
  }
  const json = async name => JSON.parse((await read(name)).toString("utf8"));
  const clipTemplates = [];
  for (const name of templates) clipTemplates.push(await json(name));
  const mapping = "extras/raindrop-mapping.json";
  return { id, remotePath: "menote", read, snapshotFileCount: [...files.keys()].filter(k => snapshotFile.test(k)).length,
    clipTemplates, raindrop: files.has(mapping) ? await json(mapping) : null };
}

// The route authenticates the account before reading the body. The ZIP remains
// private to this request; entry names are never used as extraction paths.
export async function readAccountArchive(request, callback) {
  if (busy) throw new Error("已有迁移包正在处理，请稍后重试");
  if (!request.body || Number(request.headers.get("content-length")) > archiveLimit) throw new Error("请选择不超过 256 MiB 的账号迁移 ZIP");
  busy = true;
  let dir, zip;
  try {
    dir = await mkdtemp(join(tmpdir(), "menote-import-"));
    const file = join(dir, "upload.zip");
    await pipeline(Readable.fromWeb(request.body), async function* (chunks) {
      let size = 0;
      for await (const chunk of chunks) {
        size += chunk.length;
        if (size > archiveLimit) throw new Error("迁移包超过 256 MiB");
        yield chunk;
      }
    }, createWriteStream(file, { flag: "wx", mode: 0o600 }), { signal: request.signal });
    zip = await yauzl.openPromise(file, { lazyEntries: true, autoClose: false, strictFileNames: true });
    return await callback(await indexArchive(zip));
  } finally {
    try {
      if (zip) zip.close();
      if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 3 });
    } finally { busy = false; }
  }
}

// Finish and validate the shape of the ZIP before sending any download headers.
export async function downloadAccountArchive({ db, bucket, userId }, signal) {
  const snapshot = await collectBackup(db, userId, bucket);
  if (snapshot.missingAttachments.length) throw new Error("附件缺失，请先检查附件存储，再下载备份。");
  const id = newSnapshotId();
  const dir = await mkdtemp(join(tmpdir(), "menote-export-"));
  const file = join(dir, "account.zip");
  let handle;
  try {
    handle = await open(file, "wx", 0o600);
    let chunks = [], written = 0, count = 0, total = 0, metadata = 0;
    const zip = new Zip((error, chunk) => {
      if (error) throw error;
      chunks.push(chunk);
    });
    async function flush() {
      for (const chunk of chunks) {
        written += chunk.length;
        if (written > archiveLimit) throw new Error("压缩包超过 256 MiB，请使用远程备份。");
        await handle.writeFile(chunk);
      }
      chunks = [];
    }
    async function append(path, bytes) {
      signal.throwIfAborted();
      const isAttachment = path.startsWith("attachment-");
      total += bytes.length;
      if (!isAttachment) metadata += bytes.length;
      if (++count > 35000 || bytes.length > 32 * MiB || total > 1024 * MiB || metadata > 32 * MiB) throw new Error("内容超过本地恢复包容量，请使用远程备份。");
      const name = `menote/${id}/${path}`;
      const entry = isAttachment ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 3 });
      zip.add(entry);
      entry.push(bytes, true);
      await flush();
    }
    const hash = await writeSnapshotFiles(bucket, snapshot, id, append);
    await append("COMPLETE", new TextEncoder().encode(hash));
    zip.end();
    await flush();
    await handle.close();
    handle = undefined;
    const check = await yauzl.openPromise(file, { lazyEntries: true, autoClose: false, strictFileNames: true });
    try {
      await processAccountArchive({ db, bucket, userId }, await indexArchive(check), false);
    } finally { check.close(); }
    const stream = createReadStream(file, { signal });
    stream.once("close", () => { void rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {}); });
    return new Response(Readable.toWeb(stream), { headers: {
      "Content-Type": "application/zip", "Content-Length": String(written), "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="menote-${id}.zip"`,
    } });
  } catch (error) {
    await handle?.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
    throw error;
  }
}
