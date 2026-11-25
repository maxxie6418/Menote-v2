import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml",
  ".woff": "font/woff", ".woff2": "font/woff2", ".json": "application/json",
  ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon",
};

export async function staticResponse(request, assets) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const url = new URL(request.url);
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch {
    return new Response(null, { status: 400 });
  }
  const segments = pathname.split("/");
  if (pathname.includes("\\") || segments.some((segment) => segment.startsWith("."))) {
    return new Response(null, { status: 404 });
  }
  let path = resolve(assets, `.${pathname}`);
  if (path !== assets && !path.startsWith(assets + sep)) return new Response(null, { status: 404 });
  let file = await stat(path).catch(() => null);
  if (!file?.isFile() && !extname(pathname) && !pathname.startsWith("/assets/")) {
    path = resolve(assets, "index.html");
    file = await stat(path).catch(() => null);
  }
  if (!file?.isFile()) return new Response(null, { status: 404 });
  return new Response(request.method === "HEAD" ? null : Readable.toWeb(createReadStream(path)), {
    headers: {
      "Content-Type": MIME[extname(path)] ?? "application/octet-stream",
      "Content-Length": String(file.size),
      "Cache-Control": pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
