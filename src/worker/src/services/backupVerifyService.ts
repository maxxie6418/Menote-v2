import { parseAccountExtras } from "./backupExtras";
import { parseRecoveryCodeBinding, type RecoveryCodeBinding } from "@menote/shared";
import { MAX_STORED_ATTACHMENT_BYTES } from "./attachmentService";
import { normalizeRemotePath, remoteGet, type RemoteTarget } from "./backupRemote";

export interface UploadedSnapshotSource {
  remotePath: string;
  id: string;
  read(path: string, expectedSize?: number): Promise<Uint8Array>;
  snapshotFileCount: number;
  clipTemplates: unknown[];
  raindrop: unknown;
}

type SnapshotSource = RemoteTarget | UploadedSnapshotSource;
function readFile(target: SnapshotSource, path: string, size?: number) {
  return "read" in target ? target.read(path, size) : remoteGet(target, path, size);
}

interface BackupFile { path: string; size: number; sha256: string; mime?: unknown }

export interface SnapshotAttachment {
  sha256: string;
  size: number;
  mime: string;
  referenced: boolean;
}

interface SnapshotMetadata {
  directory: string;
  files: number;
  shards: number;
  entries: unknown[];
  itemKeyWraps: unknown[];
  topicKeyWraps: unknown[];
  settings: unknown[];
  recoveryCodeBinding: RecoveryCodeBinding | null;
  accountExtras: ReturnType<typeof parseAccountExtras> | null;
  attachments: SnapshotAttachment[];
}

const sha256Pattern = /^[a-f0-9]{64}$/;

function mapBackupFiles(files: unknown[]): Map<string, BackupFile> {
  const result = new Map<string, BackupFile>();
  for (const value of files) {
    const file = value as Partial<BackupFile> | null;
    if (!file || typeof file.path !== "string" || !/^(?:\d{4}-\d{2}\.json|attachment-[a-f0-9]{64})$/.test(file.path) ||
      result.has(file.path) || typeof file.size !== "number" || !Number.isSafeInteger(file.size) || file.size < 0 ||
      typeof file.sha256 !== "string" || !sha256Pattern.test(file.sha256)) throw new Error("备份文件清单无效");
    if (file.path.startsWith("attachment-")) {
      if (file.path.slice(11) !== file.sha256) throw new Error(`附件内容哈希不符：${file.path}`);
      if (file.size > MAX_STORED_ATTACHMENT_BYTES) throw new Error(`附件超出大小限制：${file.path}`);
    }
    result.set(file.path, { path: file.path, size: file.size, sha256: file.sha256, mime: file.mime });
  }
  return result;
}

/** Verify manifest and JSON shards. Attachment bodies are read separately, one at a time. */
export async function readRemoteSnapshotMetadata(
  target: SnapshotSource, id: string, options: { expectedManifestHash?: string; discardEntries?: boolean } = {},
): Promise<SnapshotMetadata> {
  if (!/^\d{8}T\d{9}Z-[0-9a-f]{8}$/i.test(id)) throw new Error("无效的备份目录名");
  const directory = `${normalizeRemotePath(target.remotePath)}/${id}`;
  const decode = new TextDecoder("utf-8", { fatal: true });
  const marker = options.expectedManifestHash ?? decode.decode(await readFile(target, `${directory}/COMPLETE`)).trim();
  const manifestBytes = await readFile(target, `${directory}/manifest.json`);
  if (!/^[a-f0-9]{64}$/i.test(marker) || await backupDigest(manifestBytes) !== marker.toLowerCase()) throw new Error("备份清单校验失败");
  const manifest = JSON.parse(decode.decode(manifestBytes)) as {
    format?: unknown; version?: unknown; snapshotId?: unknown;
    files?: unknown[];
    shards?: Array<{ month?: unknown }>;
    counts?: { attachments?: unknown };
    extra?: { accountExtras?: unknown; itemKeyWraps?: unknown; topicKeyWraps?: unknown; settings?: unknown; recoveryCodeBinding?: unknown };
  } | null;
  if (!manifest || manifest.format !== "menote-backup" || manifest.version !== 1 || manifest.snapshotId !== id ||
    !Array.isArray(manifest.files) || !Array.isArray(manifest.shards)) throw new Error("不支持或无效的备份清单");

  const files = mapBackupFiles(manifest.files);
  if ("read" in target && target.snapshotFileCount !== files.size + 2) throw new Error("迁移包文件与清单不符");
  const shardPaths = manifest.shards.map((shard) => `${String(shard?.month)}.json`);
  const attachmentFiles = [...files.values()].filter((file) => file.path.startsWith("attachment-"));
  if (new Set(shardPaths).size !== shardPaths.length || shardPaths.some((path) => !files.has(path)) ||
    files.size !== shardPaths.length + attachmentFiles.length ||
    attachmentFiles.length !== manifest.counts?.attachments) throw new Error("备份清单文件不完整");
  const extra = manifest.extra;
  if (!Array.isArray(extra?.itemKeyWraps) || !Array.isArray(extra?.topicKeyWraps) || !Array.isArray(extra?.settings)) throw new Error("备份缺少密钥或设置数据");
  const recoveryCodeBinding = parseRecoveryCodeBinding(extra.recoveryCodeBinding);
  if (extra.recoveryCodeBinding !== undefined && !recoveryCodeBinding) throw new Error("备份恢复码绑定无效");

  const entries: unknown[] = [];
  const tables = new Set<string>();
  const references = new Set<string>();
  for (const path of shardPaths) {
    const bytes = await readVerifiedFile(target, directory, files.get(path)!);
    const shard: unknown = JSON.parse(decode.decode(bytes));
    if (!Array.isArray(shard)) throw new Error(`分片格式错误：${path}`);
    for (const entry of shard) {
      if (!options.discardEntries) entries.push(entry);
      if (entry?.kind !== "item") continue;
      if (entry.data?.type === "table") tables.add(entry.data.id);
      const raw: unknown = entry.data?.attachment_hashes_json;
      const hashes: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!Array.isArray(hashes) || hashes.some((hash) => typeof hash !== "string" || !sha256Pattern.test(hash))) {
        throw new Error("附件引用格式错误");
      }
      for (const hash of hashes) references.add(hash);
    }
  }
  for (const hash of references) if (!files.has(`attachment-${hash}`)) throw new Error("快照缺少笔记引用的附件");
  return {
    accountExtras: extra.accountExtras === undefined ? null : parseAccountExtras(extra.accountExtras, tables),
    directory, files: files.size, shards: shardPaths.length, entries,
    itemKeyWraps: extra.itemKeyWraps, topicKeyWraps: extra.topicKeyWraps, settings: extra.settings, recoveryCodeBinding,
    attachments: attachmentFiles.map(({ mime, sha256, size }) => ({
      mime: typeof mime === "string" && /^[a-z0-9][a-z0-9.+-]{0,62}\/[a-z0-9][a-z0-9.+-]{0,126}$/i.test(mime)
        ? mime : "application/octet-stream",
      sha256, size, referenced: references.has(sha256),
    })),
  };
}

async function readVerifiedFile(
  target: SnapshotSource, directory: string, file: BackupFile, exactSize?: number,
): Promise<Uint8Array> {
  const bytes = await readFile(target, `${directory}/${file.path}`, exactSize);
  if (bytes.length !== file.size || await backupDigest(bytes) !== file.sha256) throw new Error(`文件校验失败：${file.path}`);
  return bytes;
}

export async function readVerifiedAttachment(target: SnapshotSource, directory: string, file: SnapshotAttachment): Promise<Uint8Array> {
  return readVerifiedFile(target, directory, { ...file, path: `attachment-${file.sha256}` }, file.size);
}

/** Verify every file. A just-uploaded snapshot is checked against the marker to be published. */
export async function verifyRemoteSnapshot(target: RemoteTarget, id: string, expectedManifestHash?: string) {
  const snapshot = await readRemoteSnapshotMetadata(target, id, { expectedManifestHash, discardEntries: true });
  for (const file of snapshot.attachments) await readVerifiedAttachment(target, snapshot.directory, file);
  return { files: snapshot.files, shards: snapshot.shards, attachments: snapshot.attachments.length };
}

export async function backupDigest(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
