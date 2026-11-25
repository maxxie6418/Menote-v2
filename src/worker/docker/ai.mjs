import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AI_TASK_MAX_RETRIES } from "../src/services/aiService.ts";

const TASK_FILE = /^[a-f0-9-]{36}\.json$/i;

async function replaceFile(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(data), { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

function workersAi(account, token) {
  return {
    async run(model, params) {
      const path = model.split("/").map(encodeURIComponent).join("/");
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(60_000),
        redirect: "error",
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Workers AI request failed (HTTP ${response.status})`);
      }
      const { success, result } = await response.json();
      if (!success || !result) throw new Error("Workers AI inference failed");
      return result;
    },
  };
}

export async function configureAi(env, { accountId, aiToken, state }, handler) {
  if (!aiToken) return undefined;
  const directory = join(state, "ai");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  env.AI = workersAi(accountId, aiToken);
  env.AI_TASKS_QUEUE = {
    async send(body) {
      const file = `${body.taskId}.json`;
      if (!TASK_FILE.test(file)) throw new Error("Invalid AI task id");
      await replaceFile(join(directory, file), { body, attempts: 1, nextAt: Date.now() });
    },
  };

  async function drain() {
    for (const file of (await readdir(directory)).filter((name) => TASK_FILE.test(name))) {
      const path = join(directory, file);
      const task = JSON.parse(await readFile(path, "utf8"));
      if (task.nextAt > Date.now()) continue;
      let acknowledged = false;
      await handler.queue({ messages: [{
        body: task.body, attempts: task.attempts,
        ack() { acknowledged = true; }, retry() {},
      }] }, env, undefined);
      if (acknowledged) {
        await unlink(path);
      } else {
        task.attempts = Math.min(AI_TASK_MAX_RETRIES, task.attempts + 1);
        task.nextAt = Date.now() + 2 ** task.attempts * 1000;
        await replaceFile(path, task);
      }
    }
  }

  let active;
  const timer = setInterval(() => {
    if (!active) {
      active = drain().catch(() => console.error("Menote AI queue polling failed"))
        .finally(() => { active = undefined; });
    }
  }, 2_000);
  timer.unref();
  return { async close() { clearInterval(timer); await active; } };
}
