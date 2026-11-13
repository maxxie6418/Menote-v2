import { normalizeRemotePath, remoteGet, type RemoteTarget } from "./backupRemote";

/** Verify every file in a snapshot without modifying either storage. */
export async function verifyRemoteSnapshot(target: RemoteTarget, id: string) {
  if (!/^\d{8}T\d{9}Z-[0-9a-f]{8}$/i.test(id)) throw new Error("无效的备份目录名");
  const root = `${normalizeRemotePath(target.remotePath)}/${id}`;
  const decode = new TextDecoder("utf-8", { fatal: true });
  const marker = decode.decode(await remoteGet(target, `${root}/COMPLETE`)).trim();
  const manifestBytes = await remoteGet(target, `${root}/manifest.json`);
  if (!/^[a-f0-9]{64}$/i.test(marker) || await hash(manifestBytes) !== marker.toLowerCase()) throw new Error("备份清单校验失败");
  const manifest = JSON.parse(decode.decode(manifestBytes)) as {
    format?: unknown; version?: unknown; snapshotId?: unknown;
    files?: Array<{ path?: unknown; size?: unknown; sha256?: unknown }>;
    shards?: Array<{ month?: unknown }>;
    counts?: { attachments?: unknown };
  };
  if (manifest.format !== "menote-backup" || manifest.version !== 1 || manifest.snapshotId !== id || !Array.isArray(manifest.files) || !Array.isArray(manifest.shards)) throw new Error("不支持或无效的备份清单");
  const names = new Set<string>();
  const references = new Set<string>();
  for (const file of manifest.files) {
    if (!file || typeof file.path !== "string" || !/^(?:\d{4}-\d{2}\.json|attachment-[a-f0-9]{64})$/.test(file.path) || names.has(file.path) || !Number.isSafeInteger(file.size) || (file.size as number) < 0 || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error("备份文件清单无效");
    names.add(file.path);
    const bytes = await remoteGet(target, `${root}/${file.path}`);
    if (bytes.length !== file.size || await hash(bytes) !== file.sha256) throw new Error(`文件校验失败：${file.path}`);
    if (file.path.endsWith(".json")) {
      const entries: unknown = JSON.parse(decode.decode(bytes));
      if (!Array.isArray(entries)) throw new Error(`分片格式错误：${file.path}`);
      for (const entry of entries) {
        if (entry?.kind !== "item") continue;
        const raw: unknown = entry.data?.attachment_hashes_json;
        const hashes: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!Array.isArray(hashes) || hashes.some((h) => typeof h !== "string" || !/^[a-f0-9]{64}$/.test(h))) throw new Error("附件引用格式错误");
        for (const h of hashes) references.add(h);
      }
    }
    if (file.path.startsWith("attachment-") && file.path.slice(11) !== file.sha256) throw new Error(`附件内容哈希不符：${file.path}`);
  }
  const shardNames = manifest.shards.map((shard) => `${String(shard.month)}.json`);
  if (new Set(shardNames).size !== shardNames.length || shardNames.some((name) => !names.has(name)) || [...names].filter((name) => name.endsWith(".json")).length !== shardNames.length || [...names].filter((name) => name.startsWith("attachment-")).length !== manifest.counts?.attachments) throw new Error("备份清单文件不完整");
  if ([...references].some((h) => !names.has(`attachment-${h}`))) throw new Error("快照缺少笔记引用的附件");
  return { files: names.size, shards: shardNames.length, attachments: manifest.counts.attachments as number };
}

async function hash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
