import { constants } from "node:fs";
import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";

// Only application-generated object keys are used as paths. Temporary uploads
// live outside the object namespace and are published with one atomic rename.
export class LocalBucket {
  constructor(root, staging) {
    this.root = root;
    this.staging = staging;
  }

  async checkAccess() {
    await Promise.all([this.root, this.staging].map(dir => access(dir, constants.R_OK | constants.W_OK)));
  }

  path(key) {
    if (!key || key.split("/").some(part => !part || part === "." || part === ".." || /[\\:\x00-\x1f]/.test(part))) {
      throw new Error("Invalid object key");
    }
    return join(this.root, ...key.split("/"));
  }

  async head(key) {
    try { return { key, size: (await stat(this.path(key))).size }; }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }

  async get(key) {
    try {
      const bytes = await readFile(this.path(key));
      const blob = new Blob([bytes]);
      return { key, size: blob.size, body: blob.stream(), arrayBuffer: () => blob.arrayBuffer() };
    } catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }

  async put(key, value) {
    const target = this.path(key);
    const temp = join(this.staging, randomUUID());
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    try {
      await writeFile(temp, new Response(value).body, { flag: "wx", mode: 0o600 });
      await rename(temp, target);
    } finally { await rm(temp, { force: true }); }
  }

  async delete(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) await rm(this.path(key), { force: true });
  }

  async list({ prefix = "", cursor = "", limit = 1000 } = {}) {
    const keys = [];
    const walk = async (dir, base) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const key = base + entry.name;
        if (entry.isDirectory() && (prefix.startsWith(key + "/") || key.startsWith(prefix))) {
          await walk(join(dir, entry.name), key + "/");
        } else if (entry.isFile() && key.startsWith(prefix) && key > cursor) keys.push(key);
      }
    };
    await walk(this.root, "");
    const page = keys.sort().slice(0, limit);
    const objects = (await Promise.all(page.map(key => this.head(key)))).filter(Boolean);
    const truncated = keys.length > page.length;
    return { objects, truncated, ...(truncated && { cursor: page.at(-1) }) };
  }
}
