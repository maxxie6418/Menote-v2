import { collectBackupRows } from "../db/backup";
import { deleteRemoteBackup, ensureDavSnapshotDirectories, listRemoteBackups, newSnapshotId, normalizeRemotePath, remotePut, type RemoteTarget } from "./backupRemote";

/**
 * 备份服务（G9，FR-BAK-1~8；备份专项设计=管理线计划 G9 定稿）：
 * - 快照模型：每次完整状态写入独立的时间戳目录，目录含月度数据分片、附件、manifest 和 COMPLETE。
 * - 备份包 = 结构化 JSON（含加密条目密文与包装块）+ 附件（按引用打包）+ manifest；主密码/明文恢复码绝不入包（FR-BAK-5）。
 * - 可按目标保留数量清理旧快照；删除只作用于 Menote 自己命名的快照目录。
 * - 凭据：AUTH_PEPPER 派生密钥做可逆加密存储（C-7 复显口径；与内容密钥无关，G4 差异注记）。
 */

/** 凭据可逆加密（AUTH_PEPPER HKDF → AES-GCM；仅服务端，供复显与推送）。 */
export async function sealSecret(pepper: string, secret: string): Promise<string> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode("menote/backup-secret-v1") },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, new TextEncoder().encode(secret));
  const bytes = new Uint8Array(iv.length + sealed.byteLength);
  bytes.set(iv); bytes.set(new Uint8Array(sealed), iv.length);
  return btoa(String.fromCharCode(...bytes));
}

export async function openSecret(pepper: string, sealed: string): Promise<string> {
  const bytes = Uint8Array.from(atob(sealed), (char) => char.charCodeAt(0));
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper), "HKDF", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode("menote/backup-secret-v1") },
    base, { name: "AES-GCM", length: 256 }, false, ["decrypt"],
  );
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, 12) as BufferSource }, key, bytes.slice(12) as BufferSource,
  );
  return new TextDecoder().decode(plain);
}

/** 收集当前完整状态为备份 JSON（按月分片数据 + manifest 输入）。加密条目保持密文。 */
export async function collectBackup(db: D1Database, userId: string, bucket: R2Bucket): Promise<{ months: Record<string, unknown[]>; manifest: Record<string, unknown>; attachments: Array<{ key: string; bytes: ArrayBuffer }> }> {
  const { items, topics, memoComments, itemKeyWraps, topicKeyWraps, settings, attachmentHashes } = await collectBackupRows(db, userId);
  const months: Record<string, unknown[]> = {};
  const monthOf = (timestamp: unknown): string => {
    const date = new Date(typeof timestamp === "number" ? timestamp : Number(timestamp ?? 0));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  for (const item of items) {
    (months[monthOf(item.created_at)] ??= []).push({ kind: "item", data: item });
  }
  for (const comment of memoComments) {
    (months[monthOf(comment.created_at)] ??= []).push({ kind: "memo_comment", data: comment });
  }
  for (const topic of topics) {
    (months[monthOf(topic.created_at ?? 0)] ??= []).push({ kind: "topic", data: topic });
  }
  const attachments: Array<{ key: string; bytes: ArrayBuffer }> = [];
  for (const sha256 of attachmentHashes) {
    const object = await bucket.get(`${userId}/${sha256}`);
    if (object) attachments.push({ key: `attachments/${sha256}`, bytes: await object.arrayBuffer() });
  }
  const manifest = {
    format: "menote-backup",
    version: 1,
    generatedAt: new Date().toISOString(),
    shards: Object.keys(months).sort().map((month) => ({ month, entities: months[month]!.length })),
    counts: { items: items.length, topics: topics.length, memoComments: memoComments.length, attachments: attachments.length },
    note: "加密条目为密文 + item_key_wraps 包装元数据；恢复需用户凭据（FR-BAK-5）",
  };
  return {
    months,
    manifest: { ...manifest, extra: { itemKeyWraps, topicKeyWraps, settings } },
    attachments,
  };
}

/** 推送一次：建立独立快照目录，先传内容与 manifest，最后写 COMPLETE。 */
export async function pushBackup(
  ctx: { db: D1Database; userId: string; bucket: R2Bucket },
  target: RemoteTarget,
): Promise<{ ok: true; shards: number; backupId: string } | { ok: false; error: string }> {
  try {
    const { months, manifest, attachments } = await collectBackup(ctx.db, ctx.userId, ctx.bucket);
    const root = normalizeRemotePath(target.remotePath);
    const id = newSnapshotId();
    const directory = `${root}/${id}`;
    if (target.kind === "webdav") {
      // Create namespace and snapshot collection before PUT; DAV servers do not create parents implicitly.
      await ensureDavSnapshotDirectories(target, root, directory);
    }
    const files: Array<{ path: string; bytes: Uint8Array; contentType: string }> = [];
    for (const attachment of attachments) files.push({ path: `attachment-${attachment.key.split("/").pop()}`, bytes: new Uint8Array(attachment.bytes), contentType: "application/octet-stream" });
    for (const month of Object.keys(months).sort()) files.push({ path: `${month}.json`, bytes: new TextEncoder().encode(JSON.stringify(months[month])), contentType: "application/json" });
    const fileMetadata = await Promise.all(files.map(async (file) => ({ path: file.path, size: file.bytes.byteLength, sha256: await hashHex(file.bytes) })));
    const completeManifest = { ...manifest, snapshotId: id, files: fileMetadata };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(completeManifest));
    const manifestHash = await hashHex(manifestBytes);
    for (const file of files) await remotePut(target, `${directory}/${file.path}`, file.bytes, file.contentType);
    await remotePut(target, `${directory}/manifest.json`, manifestBytes, "application/json");
    await remotePut(target, `${directory}/COMPLETE`, new TextEncoder().encode(manifestHash), "text/plain");
    if (target.retentionCount > 0) {
      const backups = (await listRemoteBackups(target)).filter((backup) => backup.complete);
      for (const old of backups.slice(target.retentionCount)) await deleteRemoteBackup(target, old.id);
    }
    return { ok: true, shards: Object.keys(months).length, backupId: id };
  } catch (error) {
    return { ok: false, error: String(error).slice(0, 300) };
  }
}

function hashHex(bytes: Uint8Array): Promise<string> {
  return crypto.subtle.digest("SHA-256", bytes as BufferSource).then((digest) =>
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""));
}

export { deleteRemoteBackup, listRemoteBackups, testRemoteTarget } from "./backupRemote";
