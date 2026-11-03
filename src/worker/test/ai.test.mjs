import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

// AI 服务是纯编排（submit/run/parse），对 Miniflare D1 单元测试；AI 与队列用桩（TP8）。
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/services/aiService.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "neutral",
  conditions: ["worker", "browser"],
});
const aiService = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const MIGRATIONS = ["0003_users.sql", "0004_topics.sql", "0005_items.sql", "0006_attachments.sql", "0015_user_settings.sql", "0023_sync_engine.sql", "0035_ai.sql"];
const USER_ID = "user-1";
const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);

async function withDatabase(run) {
  const mf = new Miniflare({ workers: [{ config: {
    name: "ai-test", compatibilityDate: "2026-10-30",
    manifest: { mainModule: "main.mjs", modules: { "main.mjs": { type: "esm", contents: "export default {}" } } },
    env: { DB: { type: "d1", id: "test-ai-database" } },
  } }] });
  try {
    const db = await mf.getD1Database("DB");
    for (const file of MIGRATIONS) {
      const ddl = await readFile(fileURLToPath(new URL(`../src/db/migrations/${file}`, import.meta.url)), "utf8");
      for (const statement of ddl.split(";").map((part) => part.trim()).filter(Boolean)) {
        await db.prepare(statement).run();
      }
    }
    await db.prepare("INSERT INTO users (id, username, role, created_at) VALUES (?, ?, 'owner', ?)").bind(USER_ID, "owner", NOW).run();
    await run(db);
  } finally { await mf.dispose(); }
}

async function writeAiSettings(db, settings) {
  await db.prepare(
    "INSERT INTO user_settings (user_id, key, is_secret, value_json, value_ciphertext) VALUES (?, 'ai', 0, ?, NULL)"
      + " ON CONFLICT(user_id, key) DO UPDATE SET value_json = excluded.value_json",
  ).bind(USER_ID, JSON.stringify(settings)).run();
}

async function insertItem(db, overrides = {}) {
  const row = { id: "item-1", type: "note", encSelf: 0, ...overrides };
  const content = row.encSelf === 1 ? [null, new Uint8Array([1])] : ["正文", null];
  await db.prepare(
    `INSERT INTO items (id, user_id, type, title, content_markdown, content_ciphertext, tags_json, attachment_hashes_json, source,
       rev, meta_rev, content_hash, enc_self, in_enc_space, created_at, updated_at)
     VALUES (?, ?, ?, '标题', ?, ?, '[]', '[]', 'web', 1, 0, 'hash0', ?, 0, ?, ?)`,
  ).bind(row.id, USER_ID, row.type, content[0], content[1], row.encSelf, NOW, NOW).run();
}

function fakeEnv(db, reply) {
  const calls = [];
  const ai = { run: async (model, params) => { calls.push({ model, params }); return reply; } };
  const sent = [];
  const queue = { send: async (message) => { sent.push(message); } };
  return { env: { DB: db, AI: ai, AI_TASKS_QUEUE: queue }, sent, calls };
}

function message(body, attempts = 1) {
  const marks = [];
  return { body, attempts, ack: () => { marks.push("ack"); }, retry: () => { marks.push("retry"); }, marks };
}

const enabledSettings = { enabled: true, model: "@cf/zai-org/glm-4.7-flash", dailyCallLimit: 5 };
const submitInput = (content = "今天写了点东西") => ({ itemId: "item-1", kind: "summary", title: "标题", tags: [], content });

test("submit rejects while AI is disabled (default settings)", async () => {
  await withDatabase(async (db) => {
    const { env } = fakeEnv(db, null);
    await assert.rejects(() => aiService.submitAiTask(env, USER_ID, submitInput(), NOW),
      (error) => error instanceof aiService.AiServiceError && error.status === 409);
  });
});

test("submit queues a task, consumer runs it, usage is counted once", async () => {
  await withDatabase(async (db) => {
    await writeAiSettings(db, enabledSettings);
    await insertItem(db);
    const { env, sent } = fakeEnv(db, {
      choices: [{ message: { content: "这是摘要内容。" } }], usage: { prompt_tokens: 120, completion_tokens: 20 },
    });
    const view = await aiService.submitAiTask(env, USER_ID, submitInput(), NOW);
    assert.equal(view.status, "queued");
    assert.equal(view.reused, false);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].taskId, view.id);
    assert.equal(sent[0].userId, USER_ID);

    await aiService.runAiTask(env, sent[0], 1, NOW + 1);
    const done = await aiService.readAiTaskView(env.DB, USER_ID, view.id);
    assert.equal(done.status, "done");
    assert.deepEqual(done.result, { type: "summary", summary: "这是摘要内容。" });

    const usage = await aiService.readAiUsageSummary(env.DB, USER_ID, NOW);
    assert.equal(usage.calls, 1);
    assert.equal(usage.inputTokens, 120);
    assert.equal(usage.outputTokens, 20);
    assert.equal(usage.dailyCallLimit, 5);
  });
});

test("GLM disables thinking and drops a leftover think block", async () => {
  await withDatabase(async (db) => {
    await writeAiSettings(db, enabledSettings);
    await insertItem(db);
    const { env, sent, calls } = fakeEnv(db, {
      choices: [{ message: { content: "<think>先想一下</think>\n这是摘要。" } }], usage: {},
    });
    const view = await aiService.submitAiTask(env, USER_ID, submitInput(), NOW);
    await aiService.runAiTask(env, sent[0], 1, NOW + 1);
    assert.equal(calls[0].model, "@cf/zai-org/glm-4.7-flash");
    assert.equal(calls[0].params.max_completion_tokens, 512);
    assert.deepEqual(calls[0].params.chat_template_kwargs, { enable_thinking: false });
    const done = await aiService.readAiTaskView(env.DB, USER_ID, view.id);
    assert.deepEqual(done.result, { type: "summary", summary: "这是摘要。" });
  });
});

test("identical content reuses the finished result without re-enqueue or extra usage", async () => {
  await withDatabase(async (db) => {
    await writeAiSettings(db, enabledSettings);
    await insertItem(db);
    const { env, sent } = fakeEnv(db, { choices: [{ message: { content: "摘要" } }], usage: {} });
    const first = await aiService.submitAiTask(env, USER_ID, submitInput(), NOW);
    await aiService.runAiTask(env, sent[0], 1, NOW + 1);
    const second = await aiService.submitAiTask(env, USER_ID, submitInput(), NOW + 2);
    const firstDone = await aiService.readAiTaskView(env.DB, USER_ID, first.id);
    assert.equal(second.reused, true);
    assert.deepEqual(second.result, firstDone.result);
    assert.equal(second.id, first.id);
    assert.equal(sent.length, 1);
    const usage = await aiService.readAiUsageSummary(env.DB, USER_ID, NOW);
    assert.equal(usage.calls, 1);
  });
});

test("a running task for the same content is returned instead of double-enqueue", async () => {
  await withDatabase(async (db) => {
    await writeAiSettings(db, enabledSettings);
    await insertItem(db);
    const { env, sent } = fakeEnv(db, { choices: [{ message: { content: "摘要" } }], usage: {} });
    await aiService.submitAiTask(env, USER_ID, submitInput(), NOW);
    const second = await aiService.submitAiTask(env, USER_ID, submitInput(), NOW + 1);
    assert.equal(second.reused, false);
    assert.equal(second.status, "queued");
    assert.equal(sent.length, 1);
  });
});

test("daily budget rejects new submissions once the limit is reached", async () => {
  await withDatabase(async (db) => {
    await writeAiSettings(db, { ...enabledSettings, dailyCallLimit: 1 });
    await insertItem(db);
    const { env, sent } = fakeEnv(db, { choices: [{ message: { content: "摘要" } }], usage: {} });
    const first = await aiService.submitAiTask(env, USER_ID, submitInput(), NOW);
    await aiService.runAiTask(env, sent[0], 1, NOW + 1);
    await assert.rejects(() => aiService.submitAiTask(env, USER_ID, { ...submitInput(), content: "另一篇内容" }, NOW + 2),
      (error) => error instanceof aiService.AiServiceError && error.status === 429);
    // 消费端预算复查：队列里残留的旧任务在达限后执行即置失败，不再计费。
    await aiService.runAiTask(env, sent[0], 1, NOW + 3);
    const stale = await aiService.readAiTaskView(env.DB, USER_ID, first.id);
    assert.equal(stale.status, "done");
  });
});

test("encrypted or deleted items never submit to cloud AI", async () => {
  await withDatabase(async (db) => {
    await writeAiSettings(db, enabledSettings);
    await insertItem(db, { id: "item-enc", encSelf: 1 });
    const { env, sent } = fakeEnv(db, null);
    await assert.rejects(() => aiService.submitAiTask(env, USER_ID, { ...submitInput(), itemId: "item-enc" }, NOW),
      (error) => error instanceof aiService.AiServiceError && error.status === 404);
    assert.equal(sent.length, 0);
  });
});

test("summary only applies to notes", async () => {
  await withDatabase(async (db) => {
    await writeAiSettings(db, enabledSettings);
    await insertItem(db, { id: "item-memo", type: "memo" });
    const { env } = fakeEnv(db, null);
    await assert.rejects(() => aiService.submitAiTask(env, USER_ID, { ...submitInput(), itemId: "item-memo" }, NOW),
      (error) => error instanceof aiService.AiServiceError && error.status === 400);
  });
});

test("model failure retries below the limit and records failed at the limit", async () => {
  await withDatabase(async (db) => {
    await writeAiSettings(db, enabledSettings);
    await insertItem(db);
    const env = { DB: db, AI: { run: async () => { throw new Error("upstream 500"); } }, AI_TASKS_QUEUE: { send: async () => {} } };
    const view = await aiService.submitAiTask(env, USER_ID, submitInput(), NOW);
    const body = { taskId: view.id, userId: USER_ID, kind: "summary", title: "标题", tags: [], content: "今天写了点东西" };
    await assert.rejects(() => aiService.runAiTask(env, body, 1, NOW + 1));
    await aiService.runAiTask(env, body, aiService.AI_TASK_MAX_RETRIES, NOW + 2);
    const failed = await aiService.readAiTaskView(env.DB, USER_ID, view.id);
    assert.equal(failed.status, "failed");
    assert.match(failed.error, /upstream 500/);
    const usage = await aiService.readAiUsageSummary(env.DB, USER_ID, NOW);
    assert.equal(usage.calls, 0);
  });
});

test("queue dispatch acks finished work and retries transient failures", async () => {
  await withDatabase(async (db) => {
    await writeAiSettings(db, enabledSettings);
    await insertItem(db);
    const { env, sent } = fakeEnv(db, { choices: [{ message: { content: "摘要" } }], usage: {} });
    const view = await aiService.submitAiTask(env, USER_ID, submitInput(), NOW);
    const good = message({ taskId: view.id, userId: USER_ID, kind: "summary", title: "标题", tags: [], content: "今天写了点东西" });
    const malformed = message({ garbage: true });
    const missing = message({ taskId: "no-such", userId: USER_ID, kind: "summary", title: "", tags: [], content: "x" });
    await aiService.dispatchAiQueue(env, { messages: [good, malformed, missing] });
    assert.deepEqual(good.marks, ["ack"]);
    assert.deepEqual(malformed.marks, ["ack"]);
    assert.deepEqual(missing.marks, ["ack"]);
    const done = await aiService.readAiTaskView(env.DB, USER_ID, view.id);
    assert.equal(done.status, "done");

    const retryEnv = { DB: db, AI: { run: async () => { throw new Error("boom"); } }, AI_TASKS_QUEUE: { send: async () => {} } };
    const view2 = await aiService.submitAiTask(env, USER_ID, { ...submitInput(), content: "第二篇" }, NOW + 5);
    const retrying = message({ taskId: view2.id, userId: USER_ID, kind: "summary", title: "标题", tags: [], content: "第二篇" }, 1);
    await aiService.dispatchAiQueue(retryEnv, { messages: [retrying] });
    assert.deepEqual(retrying.marks, ["retry"]);
    assert.equal(sent.length, 2);
  });
});

test("tag recommendations parse fenced JSON and filter noise", async () => {
  assert.deepEqual(aiService.parseTagRecommendation('```json\n["工作", "读书", "#工作", 42, ""]\n```'), ["工作", "读书"]);
  assert.deepEqual(aiService.parseTagRecommendation("前缀 [\"标签A\", \"标签B\"] 后缀"), ["标签A", "标签B"]);
  assert.deepEqual(aiService.parseTagRecommendation("完全不是数组"), []);
});

test("cleanup expires stale tasks and prunes old records", async () => {
  await withDatabase(async (db) => {
    const { failStaleAiTasks, deleteStaleAiTasks } = await import(
      `data:text/javascript;base64,${Buffer.from((await build({
        entryPoints: [fileURLToPath(new URL("../src/db/ai.ts", import.meta.url))],
        bundle: true, write: false, format: "esm", platform: "neutral", conditions: ["worker", "browser"],
      })).outputFiles[0].text).toString("base64")}`
    );
    await db.prepare(
      `INSERT INTO ai_tasks (id, user_id, item_id, kind, content_hash, model, status, created_at, updated_at)
       VALUES ('t-stale', ?, 'item-1', 'summary', 'h', 'm', 'queued', ?, ?), ('t-old', ?, 'item-1', 'summary', 'h', 'm', 'done', ?, ?)`,
    ).bind(USER_ID, NOW, NOW - 7_200_000, USER_ID, NOW - 31 * 86_400_000, NOW - 31 * 86_400_000).run();
    await failStaleAiTasks(db, NOW - 3_600_000, NOW);
    await deleteStaleAiTasks(db, NOW - 30 * 86_400_000);
    const stale = await db.prepare("SELECT status, error FROM ai_tasks WHERE id = 't-stale'").first();
    assert.equal(stale.status, "failed");
    assert.match(stale.error, /超时/);
    const old = await db.prepare("SELECT COUNT(*) AS n FROM ai_tasks WHERE id = 't-old'").first();
    assert.equal(old.n, 0);
  });
});
