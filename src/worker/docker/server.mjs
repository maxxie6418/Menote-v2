import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import worker from "../src/index.ts";
import { openStorage } from "./storage.mjs";
import { downloadAccountArchive, readAccountArchive } from "./account-archive.mjs";
import { configureAi } from "./ai.mjs";
import { staticResponse } from "./assets.mjs";

function publicOrigin(value) {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("MENOTE_PUBLIC_ORIGIN must be an HTTPS origin or loopback HTTP origin");
  }
  return url.origin;
}

function settings(input) {
  function required(key) {
    const value = input[key];
    if (!value?.trim()) throw new Error(`Missing configuration: ${key}`);
    return value;
  }
  const accountId = input.CF_ACCOUNT_ID?.trim();
  const port = Number(input.PORT ?? "8787");
  if (input.CF_AI_API_TOKEN?.trim() && !/^[a-f0-9]{32}$/i.test(accountId ?? "")) throw new Error("Workers AI requires CF_ACCOUNT_ID");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  return {
    accountId,
    port,
    origin: publicOrigin(required("MENOTE_PUBLIC_ORIGIN")),
    assets: resolve(input.MENOTE_ASSETS_PATH ?? "/app/web"),
    state: resolve(input.MENOTE_STATE_PATH ?? "/app/state"),
    pepper: required("AUTH_PEPPER"),
    scheduled: input.MENOTE_SCHEDULED_JOBS === "true",
    aiToken: input.CF_AI_API_TOKEN?.trim(),
  };
}

function executionContext(pending) {
  return {
    waitUntil(promise) {
      const task = Promise.resolve(promise).catch(() => {});
      pending.add(task);
      void task.finally(() => pending.delete(task));
    },
  };
}

export function createMenoteServer({ env, origin, assets, ready }) {
  const pending = new Set();
  const context = executionContext(pending);
  const server = createServer(async (incoming, outgoing) => {
    const abort = new AbortController();
    outgoing.on("close", () => abort.abort());
    try {
      if (!incoming.url?.startsWith("/") || incoming.url.startsWith("//")) {
        outgoing.writeHead(400).end();
        return;
      }
      const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const request = new Request(origin + incoming.url, {
        method: incoming.method, headers, signal: abort.signal,
        ...(hasBody && { body: Readable.toWeb(incoming), duplex: "half" }),
      });
      const { pathname } = new URL(request.url);
      const isApi = pathname === "/api" || pathname.startsWith("/api/");
      let response;
      if (pathname === "/api/health/ready" && request.method === "GET") {
        response = await ready();
      } else if (isApi) {
        response = await worker.fetch(request, env, context);
      } else {
        response = await staticResponse(request, assets);
      }
      outgoing.statusCode = response.status;
      for (const [key, value] of response.headers) {
        if (key !== "set-cookie") outgoing.setHeader(key, value);
      }
      const cookies = response.headers.getSetCookie();
      if (cookies.length) outgoing.setHeader("Set-Cookie", cookies);
      if (response.body && request.method !== "HEAD") {
        await pipeline(Readable.fromWeb(response.body), outgoing);
      } else {
        await response.body?.cancel();
        outgoing.end();
      }
    } catch {
      if (!outgoing.headersSent && !outgoing.destroyed) outgoing.writeHead(500).end();
      else if (!outgoing.destroyed) outgoing.destroy();
    }
  });
  return { server, context, drain: () => Promise.allSettled(pending) };
}

async function main() {
  const config = settings(process.env);
  const env = {
    AUTH_PEPPER: config.pepper,
    ...await openStorage(process.env, config.state),
    DOWNLOAD_ACCOUNT_ARCHIVE: downloadAccountArchive,
    READ_ACCOUNT_ARCHIVE: readAccountArchive,
  };
  const ai = await configureAi(env, config, worker);
  const hold = new Set();
  let checking;
  function ready() {
    // Check the attachment directory and schema before accepting requests.
    if (!checking) {
      checking = (async () => {
        if (env.BUCKET.checkAccess) await env.BUCKET.checkAccess();
        else await env.BUCKET.list({ limit: 1 });
        return worker.fetch(new Request(config.origin + "/api/health/ready"), env, executionContext(hold));
      })().catch(() => Response.json({ status: "unavailable" }, { status: 503 }))
        .then(async (response) => ({ status: response.status, body: await response.json() }))
        .finally(() => { checking = undefined; });
    }
    return checking.then(({ status, body }) => Response.json(body, {
      status, headers: { "Cache-Control": "no-store" },
    }));
  }
  if (!(await ready()).ok) throw new Error("Database, object storage or schema readiness check failed");
  if (!(await stat(resolve(config.assets, "index.html"))).isFile()) throw new Error("Web build is missing");

  const { server, context, drain } = createMenoteServer({ env, origin: config.origin, assets: config.assets, ready });
  // Enable on only one instance after production cutover so the scheduled jobs
  // do not run twice while the original deployment is still serving.
  let job;
  let timer;
  let stopping = false;
  const hour = 3_600_000;
  function scheduleNextHour() {
    timer = setTimeout(() => {
      if (!job) {
        job = worker.scheduled(undefined, env, context)
          .catch(() => console.error("Menote scheduled work failed"))
          .finally(() => { job = undefined; });
      }
      if (!stopping) scheduleNextHour();
    }, hour - Date.now() % hour);
  }
  if (config.scheduled) scheduleNextHour();
  const stop = () => {
    stopping = true;
    if (timer) clearTimeout(timer);
    server.close(async () => {
      await Promise.allSettled([job, ai?.close(), drain(), ...hold]);
      env.DB.close?.();
      process.exitCode = 0;
    });
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  server.listen(config.port, process.env.MENOTE_LISTEN_ADDRESS || "0.0.0.0", () => console.log(`Menote listening on port ${config.port}`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
