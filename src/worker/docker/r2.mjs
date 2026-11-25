import { AwsClient } from "aws4fetch";

function xmlField(xml, name) {
  const pattern = new RegExp(`<${name}>([^<]*)</${name}>`);
  return xml.match(pattern)?.[1];
}

function decodeToken(value) {
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity) => entities[entity]);
}

export class R2S3Bucket {
  constructor({ accountId, bucket, accessKeyId, secretAccessKey }, client) {
    this.url = new URL(`/${encodeURIComponent(bucket)}`, `https://${accountId}.r2.cloudflarestorage.com`);
    this.client = client ?? new AwsClient({ accessKeyId, secretAccessKey, region: "auto", service: "s3" });
  }

  async request(method, key, body, query) {
    const url = new URL(this.url);
    if (key !== undefined) {
      const segments = key.split("/");
      if (segments.some((part) => part === "." || part === "..")) throw new Error("Invalid R2 object key");
      url.pathname += `/${segments.map(encodeURIComponent).join("/")}`;
    }
    if (query) url.search = query.toString();
    return this.client.fetch(url.toString(), {
      method, body, redirect: "error", signal: AbortSignal.timeout(60_000),
    });
  }

  async head(key) {
    const response = await this.request("HEAD", key);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`R2 metadata request failed (HTTP ${response.status})`);
    return { key, size: Number(response.headers.get("content-length")) };
  }

  async get(key) {
    const response = await this.request("GET", key);
    if (response.status === 404 || !response.ok) {
      await response.body?.cancel();
      if (response.status === 404) return null;
      throw new Error(`R2 download failed (HTTP ${response.status})`);
    }
    return {
      key,
      size: Number(response.headers.get("content-length")),
      body: response.body,
      arrayBuffer: () => response.arrayBuffer(),
    };
  }

  async put(key, body) {
    const response = await this.request("PUT", key, body);
    await response.body?.cancel();
    if (!response.ok) throw new Error(`R2 upload failed (HTTP ${response.status})`);
  }

  async delete(keys) {
    // The database acknowledges the whole set only after every object is deleted.
    // S3 DELETE is idempotent, so the existing cleanup job can retry the set.
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      const response = await this.request("DELETE", key);
      await response.body?.cancel();
      if (!response.ok) throw new Error(`R2 delete failed (HTTP ${response.status})`);
    }
  }

  async list({ prefix, limit = 1000, cursor } = {}) {
    const query = new URLSearchParams({ "list-type": "2", "max-keys": String(limit), "encoding-type": "url" });
    if (prefix) query.set("prefix", prefix);
    if (cursor) query.set("continuation-token", cursor);
    const response = await this.request("GET", undefined, undefined, query);
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`R2 list failed (HTTP ${response.status})`);
    }
    const xml = await response.text();
    const objects = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(([, entry]) => ({
      key: decodeURIComponent(xmlField(entry, "Key")),
      size: Number(xmlField(entry, "Size")),
    }));
    const truncated = xmlField(xml, "IsTruncated") === "true";
    const next = xmlField(xml, "NextContinuationToken");
    return { objects, truncated, ...(next && { cursor: decodeToken(next) }) };
  }
}
