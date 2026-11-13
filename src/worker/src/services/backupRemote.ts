import { AwsClient } from "aws4fetch";

export interface RemoteTarget {
  kind: "webdav" | "s3";
  endpoint: string;
  bucket: string | null;
  username: string | null;
  secret: string;
  remotePath: string;
  retentionCount: number;
}

export interface RemoteBackup { id: string; lastModified: string | null; complete: boolean }

function safePath(value: string): string {
  const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === ".." || /[\u0000-\u001f]/.test(part))) throw new Error("远端路径包含不安全片段");
  return parts.join("/");
}

function encodedPath(path: string): string {
  return path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

function baseUrl(target: RemoteTarget): URL {
  const url = new URL(target.endpoint);
  if (url.protocol !== "https:") throw new Error("地址必须使用 HTTPS");
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url;
}

function auth(target: RemoteTarget): string {
  const bytes = new TextEncoder().encode(`${target.username ?? ""}:${target.secret}`);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

function davUrl(target: RemoteTarget, path: string): string {
  const base = baseUrl(target);
  return new URL(`${base.pathname}${encodedPath(path)}`, base.origin).toString();
}

function s3Url(target: RemoteTarget, key: string): string {
  if (!target.bucket) throw new Error("S3 桶名不能为空");
  const endpointUrl = new URL(target.endpoint);
  if (endpointUrl.protocol !== "https:") throw new Error("S3 地址必须使用 HTTPS");
  const endpoint = target.endpoint.replace(/\/$/, "");
  return `${endpoint}/${encodeURIComponent(target.bucket)}/${encodedPath(key)}`;
}

async function s3(target: RemoteTarget, url: string, init: RequestInit): Promise<Response> {
  return new AwsClient({ accessKeyId: target.username ?? "", secretAccessKey: target.secret }).fetch(url, init);
}

export async function remotePut(target: RemoteTarget, path: string, body: Uint8Array | string, contentType: string): Promise<void> {
  const response = target.kind === "webdav"
    ? await fetch(davUrl(target, path), { method: "PUT", headers: { Authorization: auth(target), "Content-Type": contentType, Overwrite: "T" }, body: body as BodyInit })
    : await s3(target, s3Url(target, path), { method: "PUT", headers: { "Content-Type": contentType }, body: body as BodyInit });
  const status = response.status;
  await response.body?.cancel().catch(() => {});
  if (!response.ok) throw new Error(`${target.kind === "webdav" ? "WebDAV" : "S3"} 写入失败：HTTP ${status}`);
}

export async function remoteGet(target: RemoteTarget, path: string): Promise<Uint8Array> {
  const safe = safePath(path);
  if (safe !== path) throw new Error("无效的备份路径");
  const response = target.kind === "webdav"
    ? await fetch(davUrl(target, safe), { headers: { Authorization: auth(target) } })
    : await s3(target, s3Url(target, safe), { method: "GET" });
  if (!response.ok) throw new Error(`读取备份文件失败：HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function ensureDavDirectories(target: RemoteTarget, paths: string[]): Promise<void> {
  const seen = new Set<string>();
  for (const path of paths) {
    let current = "";
    for (const segment of path.split("/").filter(Boolean)) {
      current = current ? `${current}/${segment}` : segment;
      if (seen.has(current)) continue;
      const response = await fetch(davUrl(target, current), { method: "MKCOL", headers: { Authorization: auth(target) } });
      await response.body?.cancel().catch(() => {});
      if (!response.ok && response.status !== 405) throw new Error(`创建 WebDAV 目录 ${current} 失败：HTTP ${response.status}`);
      seen.add(current);
    }
  }
}

export async function ensureDavSnapshotDirectories(target: RemoteTarget, root: string, directory: string): Promise<void> {
  await ensureDavDirectories(target, [root, directory]);
}

export function normalizeRemotePath(value: string): string { return safePath(value || "menote"); }

export function newSnapshotId(): string {
  const timestamp = new Date().toISOString().replace(/[-:.]/g, "");
  return `${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
}

function decodeXml(value: string): string {
  return value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

async function* s3ListPages(target: RemoteTarget, prefix: string, delimiter?: string): AsyncGenerator<string> {
  let token: string | null = null;
  do {
    const query = new URLSearchParams({ "list-type": "2", "max-keys": "1000", prefix });
    if (delimiter) query.set("delimiter", delimiter);
    if (token) query.set("continuation-token", token);
    const response = await s3(target, `${s3Url(target, "")}?${query}`, { method: "GET" });
    if (!response.ok) throw new Error(`读取 S3 备份目录失败：HTTP ${response.status}`);
    const xml = await response.text();
    yield xml;
    const truncated = /<IsTruncated>true<\/IsTruncated>/i.test(xml);
    const next = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/i)?.[1];
    token = truncated && next ? decodeXml(next) : null;
  } while (token);
}

export async function listRemoteBackups(target: RemoteTarget): Promise<RemoteBackup[]> {
  const root = normalizeRemotePath(target.remotePath);
  if (target.kind === "webdav") {
    const response = await fetch(davUrl(target, root), {
      method: "PROPFIND", headers: { Authorization: auth(target), Depth: "1", "Content-Type": "application/xml" },
      body: "<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:prop><d:resourcetype/><d:getlastmodified/></d:prop></d:propfind>",
    });
    if (!response.ok && response.status !== 207) throw new Error(`读取 WebDAV 备份目录失败：HTTP ${response.status}`);
    const xml = await response.text();
    const result: RemoteBackup[] = [];
    for (const match of xml.matchAll(/<(?:[\w.-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?response>/gi)) {
      const block = match[1] ?? "";
      const href = block.match(/<(?:[\w.-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?href>/i)?.[1];
      if (!href || !/<(?:[\w.-]+:)?collection\b/i.test(block)) continue;
      const id = decodeURIComponent(new URL(href, baseUrl(target)).pathname).replace(/\/+$/, "").split("/").pop() ?? "";
      if (!/^\d{8}T\d{9}Z-[0-9a-f]{8}$/i.test(id)) continue;
      result.push({ id, lastModified: block.match(/<(?:[\w.-]+:)?getlastmodified\b[^>]*>([^<]+)/i)?.[1] ?? null, complete: false });
    }
    const checked = await Promise.all(result.map(async (backup) => ({ ...backup, complete: await hasCompleteMarker(target, `${root}/${backup.id}`) })));
    return checked.sort((a, b) => b.id.localeCompare(a.id));
  }
  const prefix = `${root}/`;
  const result: RemoteBackup[] = [];
  for await (const xml of s3ListPages(target, prefix, "/")) {
    for (const match of xml.matchAll(/<CommonPrefixes>\s*<Prefix>([^<]+)<\/Prefix>\s*<\/CommonPrefixes>/g)) {
      const id = decodeXml(match[1]!).replace(/\/$/, "").split("/").pop() ?? "";
      if (/^\d{8}T\d{9}Z-[0-9a-f]{8}$/i.test(id)) result.push({ id, lastModified: null, complete: false });
    }
  }
  const checked = await Promise.all(result.map(async (backup) => ({ ...backup, complete: await hasCompleteMarker(target, `${root}/${backup.id}`) })));
  return checked.sort((a, b) => b.id.localeCompare(a.id));
}

async function hasCompleteMarker(target: RemoteTarget, directory: string): Promise<boolean> {
  const response = target.kind === "webdav"
    ? await fetch(davUrl(target, `${directory}/COMPLETE`), { headers: { Authorization: auth(target) } })
    : await s3(target, s3Url(target, `${directory}/COMPLETE`), { method: "HEAD" });
  await response.body?.cancel().catch(() => {});
  return response.ok;
}

export async function deleteRemoteBackup(target: RemoteTarget, id: string): Promise<void> {
  if (!/^\d{8}T\d{9}Z-[0-9a-f]{8}$/i.test(id)) throw new Error("无效的备份目录名");
  const root = normalizeRemotePath(target.remotePath);
  const directory = `${root}/${id}`;
  if (target.kind === "webdav") {
    const base = baseUrl(target);
    const listing = await fetch(davUrl(target, directory), {
      method: "PROPFIND", headers: { Authorization: auth(target), Depth: "1", "Content-Type": "application/xml" },
      body: "<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:allprop/></d:propfind>",
    });
    if (!listing.ok && listing.status !== 207) throw new Error(`读取待删除快照失败：HTTP ${listing.status}`);
    const xml = await listing.text();
    const basePath = new URL(davUrl(target, directory)).pathname.replace(/\/+$/, "");
    const children = [...xml.matchAll(/<(?:[\w.-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?href>/gi)]
      .map((match) => new URL(match[1]!, base))
      .filter((url) => url.pathname.replace(/\/+$/, "") !== basePath && url.origin === base.origin);
    for (const child of children) {
      const response = await fetch(child, { method: "DELETE", headers: { Authorization: auth(target) } });
      const status = response.status;
      await response.body?.cancel().catch(() => {});
      if (!response.ok && status !== 404) throw new Error(`删除 WebDAV 快照文件失败：HTTP ${status}`);
    }
    const response = await fetch(davUrl(target, directory), { method: "DELETE", headers: { Authorization: auth(target) } });
    const status = response.status;
    await response.body?.cancel().catch(() => {});
    if (!response.ok && status !== 404) throw new Error(`删除 WebDAV 快照目录失败：HTTP ${status}`);
    return;
  }
  for await (const xml of s3ListPages(target, `${directory}/`)) {
    for (const match of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) {
      const key = decodeXml(match[1]!);
      if (!key.startsWith(`${directory}/`)) continue;
      const response = await s3(target, s3Url(target, key), { method: "DELETE" });
      const status = response.status;
      await response.body?.cancel().catch(() => {});
      if (!response.ok && status !== 404) throw new Error(`删除 S3 快照对象失败：HTTP ${status}`);
    }
  }
}

export async function testRemoteTarget(target: RemoteTarget): Promise<{ ok: boolean; error?: string }> {
  const root = normalizeRemotePath(target.remotePath);
  const check = `${root}/.menote-check-${crypto.randomUUID()}`;
  try {
    if (target.kind === "webdav") {
      const base = baseUrl(target);
      const probe = await fetch(base, { method: "PROPFIND", headers: { Authorization: auth(target), Depth: "0", "Content-Type": "application/xml" }, body: "<?xml version=\"1.0\"?><d:propfind xmlns:d=\"DAV:\"><d:allprop/></d:propfind>" });
      const status = probe.status;
      await probe.body?.cancel().catch(() => {});
      if (!probe.ok && status !== 207 && status !== 405) throw new Error(`WebDAV 地址检查失败：HTTP ${status}`);
      await ensureDavDirectories(target, [root]);
    }
    const payload = new TextEncoder().encode("menote connection test");
    let created = false;
    try {
      await remotePut(target, check, payload, "text/plain");
      created = true;
      const get = target.kind === "webdav"
        ? await fetch(davUrl(target, check), { headers: { Authorization: auth(target) } })
        : await s3(target, s3Url(target, check), { method: "GET" });
      const content = get.ok ? new Uint8Array(await get.arrayBuffer()) : new Uint8Array();
      if (!get.ok || new TextDecoder().decode(content) !== "menote connection test") throw new Error(`写入后读取失败：HTTP ${get.status}`);
      await listRemoteBackups(target);
    } finally {
      if (created) {
        const del = target.kind === "webdav"
          ? await fetch(davUrl(target, check), { method: "DELETE", headers: { Authorization: auth(target) } })
          : await s3(target, s3Url(target, check), { method: "DELETE" });
        const status = del.status;
        await del.body?.cancel().catch(() => {});
        if (!del.ok && status !== 404) throw new Error(`测试文件删除失败：HTTP ${status}`);
      }
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error).slice(0, 300) };
  }
}
