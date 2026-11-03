import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

// TP9：Raindrop 连接器（行读写/拉取与推送分类/绑定与拉推全链路）。
// 打包目标其实是 workerd/浏览器：不补条件时 worker 依赖会解析到 node shim，测试会集体失败。
async function bundleModule(entry) {
  const out = await build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true, write: false, format: "esm", platform: "neutral",
    conditions: ["worker", "browser"], loader: { ".sql": "text" },
  });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
}

const table = await bundleModule("../src/services/raindropTable.ts");
const service = await bundleModule("../src/services/raindropService.ts");
const api = await bundleModule("../src/services/raindropApi.ts");
const migrationBundle = await build({
  entryPoints: [fileURLToPath(new URL("./migration-worker.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "neutral",
  conditions: ["worker", "browser"], loader: { ".sql": "text" },
});

const FIELDS = (overrides = {}) => ({
  title: "标题", link: "https://example.com/a", excerpt: "", note: "", tags: ["x"],
  type: "link", cover: "", capturedAt: "2026-11-01T00:00:00Z", important: false, ...overrides,
});

async function digest(fields) {
  // 镜像 raindropService.canonicalFields：tags 忽略大小写与顺序、capturedAt 按时刻、type 不参与。
  const ts = Date.parse(fields.capturedAt);
  const canonical = JSON.stringify({
    title: fields.title, link: fields.link, excerpt: fields.excerpt, note: fields.note,
    tags: [...fields.tags].map((tag) => tag.toLowerCase()).sort(), cover: fields.cover,
    capturedAt: Number.isFinite(ts) ? String(ts) : fields.capturedAt, important: fields.important,
  });
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

test("backfillRowIds adds the row-id column once and is idempotent", () => {
  const doc = "---\nfields:\n  标题:\n    type: text\n---\n\n| 标题 |\n| --- |\n| 甲 |\n| 乙 |\n";
  const first = table.backfillRowIds(doc);
  assert.equal(first.rowIds.length, 2);
  assert.ok(first.markdown.includes("| 行 ID |"));
  assert.ok(first.markdown.startsWith("---\n"));
  const second = table.backfillRowIds(first.markdown);
  assert.equal(second.rowIds.length, 2);
  assert.deepEqual(second.rowIds, first.rowIds);
});

test("upsertRows updates by row id, keeps unknown columns and escapes pipes", () => {
  const doc = "| 标题 | 网址 | 自定义 |\n| --- | --- | --- |\n| 甲 | https://a | 保留 |\n";
  const seeded = table.backfillRowIds(doc);
  const rowId = seeded.rowIds[0];
  const next = table.upsertRows(seeded.markdown, [{ rowId, fields: FIELDS({ note: "含|竖线", title: "新题" }) }],
    [{ rowId: "newrow12345", fields: FIELDS({ title: "追加", link: "https://b" }) }]);
  const rows = table.readRows(next);
  assert.equal(rows.length, 2);
  const updated = rows.find((row) => row.rowId === rowId);
  assert.equal(updated.cells["自定义"], "保留");
  const fields = table.fieldsFromCells(updated.cells);
  assert.equal(fields.title, "新题");
  assert.equal(fields.note, "含|竖线");
  const appended = rows.find((row) => row.rowId === "newrow12345");
  assert.equal(appended.cells["网址"], "https://b");
});

test("planPull classifies append/skip/update/dirty/conflict/missing/orphan", async () => {
  const rows = [
    { rowId: "r1", fields: FIELDS({ link: "https://x/1", title: "本地同址行" }) },
    { rowId: "r2", fields: FIELDS({ link: "https://x/2", title: "旧" }) },
    { rowId: "r3", fields: FIELDS({ link: "https://x/3", title: "本地改" }) },
    { rowId: "r4", fields: FIELDS({ link: "https://x/4", title: "未变" }) },
    { rowId: "r5", fields: FIELDS({ link: "https://x/7", title: "远端将消失" }) },
    { rowId: "r6", fields: FIELDS({ link: "https://x/8", title: "本地新题" }) },
  ];
  const ledger = [
    { menoteRowId: "r2", raindropId: "102", baselineHash: await digest(FIELDS({ link: "https://x/2", title: "旧" })), baselineJson: JSON.stringify(FIELDS({ link: "https://x/2", title: "旧" })), status: "synced" },
    { menoteRowId: "r3", raindropId: "103", baselineHash: await digest(FIELDS({ link: "https://x/3", title: "远端旧" })), baselineJson: JSON.stringify(FIELDS({ link: "https://x/3", title: "远端旧" })), status: "synced" },
    { menoteRowId: "r4", raindropId: "106", baselineHash: await digest(FIELDS({ link: "https://x/4", title: "未变" })), baselineJson: JSON.stringify(FIELDS({ link: "https://x/4", title: "未变" })), status: "synced" },
    { menoteRowId: "r5", raindropId: "107", baselineHash: await digest(FIELDS({ link: "https://x/7", title: "远端将消失" })), baselineJson: JSON.stringify(FIELDS({ link: "https://x/7", title: "远端将消失" })), status: "synced" },
    { menoteRowId: "r6", raindropId: "108", baselineHash: await digest(FIELDS({ link: "https://x/8", title: "远端原始" })), baselineJson: JSON.stringify(FIELDS({ link: "https://x/8", title: "远端原始" })), status: "synced" },
    { menoteRowId: "gone", raindropId: "104", baselineHash: "x", baselineJson: "{}", status: "synced" },
  ];
  const remote = [
    { remoteId: "101", fields: FIELDS({ link: "https://x/1", title: "本地同址行" }) },
    { remoteId: "102", fields: FIELDS({ link: "https://x/2", title: "新" }) },
    { remoteId: "103", fields: FIELDS({ link: "https://x/3", title: "远端新" }) },
    { remoteId: "105", fields: FIELDS({ link: "https://x/5", title: "全新" }) },
    { remoteId: "106", fields: FIELDS({ link: "https://x/4", title: "未变" }) },
    { remoteId: "108", fields: FIELDS({ link: "https://x/8", title: "远端原始" }) },
  ];
  const plan = await service.planPull(rows, ledger, remote);
  assert.equal(plan.counts.pulledNew, 2, "101 与 105 均无账本；同 URL 不自动合并，照常追加");
  assert.deepEqual(plan.appends.map((entry) => entry.remoteId).sort(), ["101", "105"]);
  assert.equal(plan.counts.skipped, 1);
  assert.equal(plan.counts.pulledUpdated, 1);
  assert.equal(plan.counts.conflicts, 1, "本地与远端同时变化才是冲突");
  assert.equal(plan.counts.remoteMissing, 1);
  assert.equal(plan.counts.orphans, 1);
  assert.equal(plan.updates[0].rowId, "r2");
  assert.ok(!plan.updates.some((entry) => entry.rowId === "r3"), "冲突行不得被覆盖");
  assert.equal(plan.statusUpdates.find((entry) => entry.menoteRowId === "r3").status, "conflict");
  const dirty = plan.statusUpdates.find((entry) => entry.menoteRowId === "r6");
  assert.equal(dirty.status, "dirty", "远端未变、本地有编辑是普通脏行而非冲突");
  assert.equal(plan.statusUpdates.find((entry) => entry.menoteRowId === "r5").status, "remote_missing");
  assert.equal(plan.statusUpdates.find((entry) => entry.menoteRowId === "gone").status, "orphaned");
});

test("planPush classifies create/update/clean/remote-missing and computes field-level diff", async () => {
  const baselineThree = FIELDS({ link: "https://x/3", title: "基线题", note: "原备注" });
  const rows = [
    { rowId: "p1", fields: FIELDS({ link: "https://x/1", title: "未绑定" }) },
    { rowId: "p2", fields: FIELDS({ link: "https://x/2", title: "干净行" }) },
    { rowId: "p3", fields: FIELDS({ link: "https://x/3", title: "改题", note: "原备注", tags: ["News"] }) },
    { rowId: "p4", fields: FIELDS({ link: "https://x/4", title: "远端消失行" }) },
    { rowId: "p5", fields: FIELDS({ link: "https://x/5", title: "本地删行" }) },
  ];
  const ledger = [
    { menoteRowId: "p2", raindropId: "202", baselineHash: await digest(FIELDS({ link: "https://x/2", title: "干净行" })), baselineJson: JSON.stringify(FIELDS({ link: "https://x/2", title: "干净行" })), status: "synced" },
    { menoteRowId: "p3", raindropId: "203", baselineHash: await digest(baselineThree), baselineJson: JSON.stringify(baselineThree), status: "synced" },
    { menoteRowId: "p4", raindropId: "204", baselineHash: "x", baselineJson: "{}", status: "remote_missing" },
    { menoteRowId: "p5", raindropId: "205", baselineHash: "x", baselineJson: "{}", status: "orphaned" },
  ];
  const plan = await service.planPush(rows, ledger);
  assert.deepEqual(plan.creates.map((entry) => entry.rowId), ["p1"]);
  assert.deepEqual(plan.updates.map((entry) => entry.rowId), ["p3"]);
  assert.equal(plan.updates[0].raindropId, "203");
  assert.deepEqual([...plan.updates[0].diffKeys].sort(), ["tags", "title"], "只推差异字段，type 不参与");
  assert.deepEqual(plan.skipsRemoteMissing.map((entry) => entry.rowId), ["p4"], "远端已消失默认不重建");
  assert.equal(plan.cleanCount, 2);
});

test("diffFieldKeys ignores tag case/order and timestamp format; type is never pushed", async () => {
  const baseline = FIELDS({ tags: ["News", "ai"], capturedAt: "2026-01-01T00:00:00Z", type: "link" });
  const current = FIELDS({ tags: ["AI", "news"], capturedAt: "2026-01-01T08:00:00+08:00", type: "article" });
  assert.deepEqual(api.diffFieldKeys(baseline, current), [], "大小写/顺序/时刻等价则无差异");
  const changed = FIELDS({ tags: ["News", "ai"], capturedAt: "2026-01-01T00:00:00Z", type: "article", note: "改动" });
  assert.deepEqual(api.diffFieldKeys(baseline, changed), ["note"]);
});

test("pushThreshold triggers confirmation beyond max(20, half of rows)", () => {
  assert.equal(service.pushThreshold(10), 20);
  assert.equal(service.pushThreshold(101), 51);
});

test("mapRemoteItem maps nulls to empty defaults", () => {
  const mapped = api.mapRemoteItem({
    _id: 7, link: "https://y", title: "T", excerpt: null, note: null, tags: null,
    type: null, cover: null, created: null, important: null,
  });
  assert.equal(mapped.remoteId, "7");
  assert.deepEqual(mapped.fields.tags, []);
  assert.equal(mapped.fields.type, "link");
  assert.equal(mapped.fields.important, false);
  assert.equal(mapped.fields.capturedAt, "");
});

/** 有状态远端桩：收藏可增改，POST 模拟服务端归一（tags 小写化）；支持注入一次性 POST 失败。 */
function statefulStub({ initial = [], collections = [] } = {}) {
  const store = new Map(initial.map((item) => [String(item._id), { ...item }]));
  const calls = { post: 0, put: 0 };
  let failFirstPost = false;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init.method || "GET").toUpperCase();
    if (url.includes("/v1/collections")) {
      if (collections === "unauthorized") return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
      return Response.json({ items: collections.map((entry) => ({ _id: entry.id, title: entry.title })) });
    }
    if (url.endsWith("/v1/raindrop") && method === "POST") {
      calls.post += 1;
      const body = JSON.parse(init.body ?? "{}");
      const id = 9000 + store.size + 1;
      const item = {
        _id: id, link: body.link, title: body.title ?? "", excerpt: body.excerpt ?? null, note: body.note ?? null,
        tags: (body.tags ?? []).map((tag) => tag.toLowerCase()), type: body.type ?? "link", cover: body.cover ?? null,
        created: body.created ?? "2026-11-03T00:00:00.000Z", important: body.important === true,
      };
      store.set(String(id), item);
      // failFirstPost：模拟“服务端已创建但响应丢失”（结果未知），用于验证 URL 扫描绑定而非重复创建。
      if (failFirstPost && calls.post === 1) return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
      return Response.json({ item });
    }
    const single = url.match(/\/v1\/raindrop\/(\d+)$/);
    if (single) {
      const item = store.get(single[1]);
      if (!item) return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
      if (method === "GET") return Response.json({ item });
      if (method === "PUT") {
        calls.put += 1;
        const patch = JSON.parse(init.body ?? "{}");
        if (patch.title !== undefined) item.title = patch.title;
        if (patch.link !== undefined) item.link = patch.link;
        if (patch.excerpt !== undefined) item.excerpt = patch.excerpt;
        if (patch.note !== undefined) item.note = patch.note;
        if (patch.tags !== undefined) item.tags = patch.tags.map((tag) => tag.toLowerCase());
        if (patch.cover !== undefined) item.cover = patch.cover;
        if (patch.created !== undefined) item.created = patch.created;
        if (patch.important !== undefined) item.important = patch.important;
        return Response.json({ item });
      }
    }
    const page = Number(new URL(url).searchParams.get("page") ?? 0);
    const all = [...store.values()];
    return Response.json({ items: all.slice(page * 50, page * 50 + 50), count: all.length });
  };
  return { store, calls, failNextPost: () => { failFirstPost = true; } };
}

const remoteItem = (id, link, title) => ({
  _id: id, link, title, excerpt: null, note: null, tags: ["标签一"], type: "link",
  cover: null, created: "2026-11-01T08:00:00.000Z", important: false,
});

async function withDatabase(run) {
  const mf = new Miniflare({
    workers: [{
      config: {
        name: "raindrop-test", compatibilityDate: "2026-10-30",
        manifest: { mainModule: "main.mjs", modules: { "main.mjs": { type: "esm", contents: migrationBundle.outputFiles[0].text } } },
        env: { DB: { type: "d1", id: "test-raindrop-database" } },
      },
    }],
  });
  try {
    const db = await mf.getD1Database("DB");
    const migrated = await (await mf.dispatchFetch("http://localhost/")).text();
    assert.ok(migrated.length > 0, "迁移应完成");
    const now = Date.now();
    await db.prepare("INSERT INTO users (id, username, role, created_at) VALUES ('u1', 'owner', 'owner', ?)").bind(now).run();
    await db.prepare(
      `INSERT INTO items (id, user_id, type, title, content_markdown, tags_json, attachment_hashes_json, source, rev, meta_rev, content_hash, created_at, updated_at)
       VALUES ('t1', 'u1', 'table', '书签', ?, '[]', '[]', 'local', 3, 0, 'h', ?, ?)`,
    ).bind("---\nfields:\n  标题:\n    type: text\n---\n\n| 标题 | 网址 |\n| --- | --- |\n| 本地一 | https://a.example/1 |\n| 本地二 | https://a.example/2 |\n", now, now).run();
    await db.prepare(
      "INSERT INTO user_settings (user_id, key, is_secret, value_json, value_ciphertext, rev, updated_at) VALUES ('u1', 'raindrop', 0, '{\"enabled\":true}', NULL, 1, ?)",
    ).bind(now).run();
    await run(db, { DB: db, AUTH_PEPPER: "test-pepper" });
  } finally {
    globalThis.fetch = realFetch;
    await mf.dispose();
  }
}

const realFetch = globalThis.fetch;

const readItemMarkdown = async (db) =>
  String((await db.prepare("SELECT content_markdown FROM items WHERE id = 't1'").first()).content_markdown);
const ledgerRows = async (db) =>
  (await db.prepare("SELECT * FROM raindrop_sync_rows WHERE user_id = 'u1' ORDER BY menote_row_id").all()).results;
const dataRowCount = async (markdown) => table.readRows(markdown).length;
const ledgerStatuses = async (db) => (await ledgerRows(db)).map((row) => row.status).sort();

test("bind backfills row ids; pull appends remote rows and is echo-safe on repeat", async () => {
  await withDatabase(async (db, env) => {
    statefulStub({ initial: [remoteItem(101, "https://r.example/1", "远端一"), remoteItem(102, "https://r.example/2", "远端二")] });
    await service.saveToken(env, "u1", "rt_token");
    const binding = await service.bindTable(env, "u1", { tableItemId: "t1", collectionId: 0, pullIntervalHours: 1 });
    assert.equal(binding.tableItemId, "t1");
    const boundMarkdown = await readItemMarkdown(db);
    assert.ok(boundMarkdown.includes("| 行 ID |"));
    assert.equal((await dataRowCount(boundMarkdown)), 2);

    const outcome = await service.runPull(env, "u1", "manual");
    assert.equal(outcome.pulledNew, 2);
    const afterPull = await readItemMarkdown(db);
    assert.equal(await dataRowCount(afterPull), 4, "本地 2 行 + 远端 2 行");
    assert.equal((await ledgerRows(db)).length, 2);
    assert.deepEqual(await ledgerStatuses(db), ["synced", "synced"]);

    const repeat = await service.runPull(env, "u1", "scheduled");
    assert.equal(repeat.pulledNew, 0);
    assert.equal(repeat.skipped, 2, "远端未变时第二轮只跳过");
    assert.equal(await dataRowCount(await readItemMarkdown(db)), 4, "重复拉取零重复行");
    const runs = (await service.readStatus(db, "u1")).runs;
    assert.equal(runs.length, 2);
    assert.equal(runs[0].status, "ok");
  });
});

test("remote edit updates a clean row; local edit plus remote edit conflicts without overwrite", async () => {
  await withDatabase(async (db, env) => {
    const stub = statefulStub({ initial: [remoteItem(201, "https://r.example/1", "远端一")] });
    await service.saveToken(env, "u1", "rt_token");
    await service.bindTable(env, "u1", { tableItemId: "t1", collectionId: 0, pullIntervalHours: 1 });
    await service.runPull(env, "u1", "manual");

    stub.store.get("201").title = "远端一改";
    const updated = await service.runPull(env, "u1", "manual");
    assert.equal(updated.pulledUpdated, 1);
    assert.ok((await readItemMarkdown(db)).includes("| 远端一改 |"));

    await db.prepare("UPDATE items SET content_markdown = replace(content_markdown, '| 远端一改 |', '| 本地改动 |') WHERE id = 't1'").run();
    stub.store.get("201").title = "远端一改二";
    const conflicted = await service.runPull(env, "u1", "manual");
    assert.equal(conflicted.conflicts, 1);
    const markdown = await readItemMarkdown(db);
    assert.ok(markdown.includes("| 本地改动 |"), "冲突行保留本地内容");
    assert.ok(!markdown.includes("远端一改二"));
    assert.equal((await ledgerRows(db)).find((row) => row.raindrop_id === "201").status, "conflict");
  });
});

test("push creates unbound rows with read-back baseline; updates dirty rows with diff-only PUT", async () => {
  await withDatabase(async (db, env) => {
    const stub = statefulStub({ initial: [remoteItem(401, "https://r.example/1", "远端一")] });
    await service.saveToken(env, "u1", "rt_token");
    await service.bindTable(env, "u1", { tableItemId: "t1", collectionId: 0, pullIntervalHours: 1 });
    await service.runPull(env, "u1", "manual");

    const preview = await service.previewPush(env, "u1");
    assert.equal(preview.creates.length, 2, "两条插件本地行未绑定 → 将创建");
    assert.equal(preview.updates.length, 0);
    assert.equal(preview.requiresConfirm, false);

    const outcome = await service.runPush(env, "u1", { confirm: true });
    assert.equal(outcome.pushCreated, 2);
    assert.equal(outcome.pushFailed, 0);
    assert.equal(stub.store.size, 3, "远端新增两条收藏，无重复");
    assert.equal((await ledgerRows(db)).length, 3);
    const createdLedger = (await ledgerRows(db)).filter((row) => row.raindrop_id !== "401");
    for (const row of createdLedger) {
      const baseline = JSON.parse(row.baseline_json);
      assert.deepEqual(baseline.tags, []);
      assert.equal(baseline.capturedAt, "", "行未填采集时间 → 基线以行内容为准（通配以远端为准，不产生永久脏行）");
      assert.equal(row.status, "synced");
    }
    assert.equal((await service.readStatus(db, "u1")).runs[0].status, "ok");

    stub.store.get("401").note = "远端附注";
    await service.runPull(env, "u1", "manual");
    await db.prepare("UPDATE items SET content_markdown = replace(content_markdown, '| 远端一 |', '| 本地改题 |') WHERE id = 't1'").run();
    const updatePreview = await service.previewPush(env, "u1");
    assert.deepEqual(updatePreview.updates.map((entry) => entry.title), ["本地改题"]);

    const putBefore = stub.calls.put;
    const pushed = await service.runPush(env, "u1", { confirm: true });
    assert.equal(pushed.pushUpdated, 1);
    assert.equal(stub.calls.put, putBefore + 1, "只调一次 PUT");
    assert.equal(JSON.parse((await ledgerRows(db)).find((row) => row.raindrop_id === "401").baseline_json).title, "本地改题", "写后回读校准基线");
  });
});

test("push read-back detects remote drift as conflict without overwrite", async () => {
  await withDatabase(async (db, env) => {
    const stub = statefulStub({ initial: [remoteItem(501, "https://r.example/1", "远端一")] });
    await service.saveToken(env, "u1", "rt_token");
    await service.bindTable(env, "u1", { tableItemId: "t1", collectionId: 0, pullIntervalHours: 1 });
    await service.runPull(env, "u1", "manual");

    stub.store.get("501").title = "远端也改了";
    await db.prepare("UPDATE items SET content_markdown = replace(content_markdown, '| 远端一 |', '| 本地改动 |') WHERE id = 't1'").run();
    const conflicted = await service.runPush(env, "u1", { confirm: true });
    assert.equal(conflicted.conflicts, 1);
    assert.equal(conflicted.pushUpdated, 0);
    assert.equal(stub.calls.put, 0, "远端有新改动绝不 PUT 覆盖");
    assert.equal((await ledgerRows(db)).find((row) => row.raindrop_id === "501").status, "conflict");
    assert.ok((await readItemMarkdown(db)).includes("| 本地改动 |"));
  });
});

test("unknown create (server created but response lost) binds by URL scan without duplicating", async () => {
  await withDatabase(async (db, env) => {
    const stub = statefulStub({ initial: [remoteItem(501, "https://r.example/1", "远端一")] });
    await service.saveToken(env, "u1", "rt_token");
    await service.bindTable(env, "u1", { tableItemId: "t1", collectionId: 0, pullIntervalHours: 1 });
    await service.runPull(env, "u1", "manual");

    stub.failNextPost();
    const outcome = await service.runPush(env, "u1", { confirm: true });
    assert.equal(outcome.pushFailed, 0);
    assert.equal(outcome.pushCreated, 2, "本地两行创建；POST 丢失的一条经 URL 扫描绑定既有收藏");
    assert.equal(stub.store.size, 3, "无重复创建");
    assert.equal((await ledgerRows(db)).length, 3);
    assert.ok((await ledgerRows(db)).some((row) => row.raindrop_id === "9002"), "响应丢失的创建绑定服务端已建的 _id");
  });
});

test("remote-vanished rows are only marked; push skips them; disabled connector fails closed; unbind clears ledger", async () => {
  await withDatabase(async (db, env) => {
    const stub = statefulStub({ initial: [remoteItem(301, "https://r.example/1", "远端一"), remoteItem(302, "https://r.example/2", "远端二")] });
    await service.saveToken(env, "u1", "rt_token");
    await service.bindTable(env, "u1", { tableItemId: "t1", collectionId: 0, pullIntervalHours: 1 });
    await service.runPull(env, "u1", "manual");

    stub.store.delete("302");
    const outcome = await service.runPull(env, "u1", "manual");
    assert.equal(outcome.remoteMissing, 1);
    assert.equal(await dataRowCount(await readItemMarkdown(db)), 4, "远端消失不删本地行");
    assert.ok((await ledgerStatuses(db)).includes("remote_missing"));

    const pushPreview = await service.previewPush(env, "u1");
    assert.deepEqual(pushPreview.remoteMissing.map((entry) => entry.raindropId), ["302"]);
    const pushed = await service.runPush(env, "u1", { confirm: true });
    assert.equal(pushed.skipped, 1, "远端已消失的行默认不重建");
    assert.equal(pushed.pushCreated, 2, "两条本地未绑定行正常创建");
    assert.equal(stub.store.size, 3, "远端消失不阻止其余行创建");

    await db.prepare("UPDATE user_settings SET value_json = '{\"enabled\":false}' WHERE user_id = 'u1' AND key = 'raindrop'").run();
    await assert.rejects(() => service.runPull(env, "u1", "manual"), /raindrop_connector_disabled/);
    await assert.rejects(() => service.runPush(env, "u1", { confirm: true }), /raindrop_connector_disabled/);
    const runsBefore = (await service.readStatus(db, "u1")).runs.length;
    await service.runScheduledPulls(env, Date.now());
    assert.equal((await service.readStatus(db, "u1")).runs.length, runsBefore, "定时任务在开关关闭时静默跳过");

    await service.unbindTable(db, "u1");
    assert.equal((await ledgerRows(db)).length, 0);
    const status = await service.readStatus(db, "u1");
    assert.equal(status.binding, null);
  });
});

test("token validation rejects unauthorized tokens", async () => {
  await withDatabase(async (db, env) => {
    statefulStub({ collections: "unauthorized" });
    await assert.rejects(() => service.saveToken(env, "u1", "bad"), /raindrop_token_invalid/);
  });
});
