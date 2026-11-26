import { bytesToBase64, encodeBackupRow, type RemoteBackupPushResult } from "@menote/shared";
import { collectBackupRows } from "../db/backup";
import { MAX_STORED_ATTACHMENT_BYTES } from "./attachmentService";
import {
  deleteRemoteBackup, ensureDavSnapshotDirectories, listRemoteBackups, newSnapshotId, normalizeRemotePath,
  remoteGet, remotePut, removeCompleteMarker, type RemoteTarget,
} from "./backupRemote";
import { backupDigest, verifyRemoteSnapshot } from "./backupVerifyService";

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
  return bytesToBase64(bytes);
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

/** Collect the current state and check referenced objects without loading their bodies. */
export async function collectBackup(db: SqlDatabase, userId: string, bucket: AttachmentBucket) {
  const { items, topics, memoComments, itemKeyWraps, topicKeyWraps, settings, attachmentHashes, attachmentObjects, recoveryCodeBinding, clipTemplates, raindrop } = await collectBackupRows(db, userId);
  const months: Record<string, unknown[]> = {};
  const monthOf = (timestamp: unknown): string => {
    const date = new Date(typeof timestamp === "number" ? timestamp : Number(timestamp ?? 0));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  for (const item of items.map(encodeBackupRow)) {
    (months[monthOf(item.created_at)] ??= []).push({ kind: "item", data: item });
  }
  for (const comment of memoComments.map(encodeBackupRow)) {
    (months[monthOf(comment.created_at)] ??= []).push({ kind: "memo_comment", data: comment });
  }
  for (const topic of topics.map(encodeBackupRow)) {
    (months[monthOf(topic.created_at ?? 0)] ??= []).push({ kind: "topic", data: topic });
  }
  const attachments: Array<{ key: string; sha256: string; mime: string }> = [];
  const missingAttachments: string[] = [];
  for (const sha256 of attachmentHashes) {
    const metadata = attachmentObjects.get(sha256);
    const key = metadata ? metadata.key : `${userId}/${sha256}`;
    if (!key) { missingAttachments.push(sha256); continue; }
    const object = await bucket.head(key);
    if (!object) { missingAttachments.push(sha256); continue; }
    if (object.size > MAX_STORED_ATTACHMENT_BYTES) throw new Error(`附件超出大小限制：${sha256}`);
    attachments.push({ key, sha256, mime: metadata?.mime ?? "application/octet-stream" });
  }
  const manifest = {
    format: "menote-backup",
    version: 1,
    generatedAt: new Date().toISOString(),
    shards: Object.keys(months).sort().map((month) => ({ month, entities: months[month]!.length })),
    counts: { items: items.length, topics: topics.length, memoComments: memoComments.length, attachments: attachments.length },
    note: "加密条目为密文 + item_key_wraps 包装元数据；恢复需用户凭据（FR-BAK-5）",
    ...(missingAttachments.length > 0 ? { missingAttachments } : {}),
  };
  return {
    months,
    manifest: {
      ...manifest,
      extra: {
        accountExtras: { clipTemplates, raindrop },
        itemKeyWraps: itemKeyWraps.map(encodeBackupRow),
        topicKeyWraps: topicKeyWraps.map(encodeBackupRow),
        settings: settings.map(encodeBackupRow),
        ...(recoveryCodeBinding ? { recoveryCodeBinding } : {}),
      },
    },
    attachments,
    missingAttachments,
  };
}

export async function writeSnapshotFiles(
  bucket: AttachmentBucket, snapshot: Awaited<ReturnType<typeof collectBackup>>, id: string,
  write: (path: string, bytes: Uint8Array, mime: string) => Promise<void>,
) {
  const { attachments, months, manifest } = snapshot;
  const fileMetadata: Array<{ path: string; size: number; sha256: string; mime?: string }> = [];
  for (const { key, sha256, mime } of attachments) {
    const object = await bucket.get(key);
    if (!object) throw new Error(`引用附件缺失：${sha256}`);
    if (object.size > MAX_STORED_ATTACHMENT_BYTES) {
      await object.body.cancel().catch(() => {});
      throw new Error(`附件超出大小限制：${sha256}`);
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    const path = `attachment-${sha256}`;
    if (await backupDigest(bytes) !== sha256) throw new Error(`附件内容哈希不符：${path}`);
    await write(path, bytes, mime);
    fileMetadata.push({ path, size: bytes.byteLength, sha256, mime });
  }
  const encode = new TextEncoder();
  for (const { month } of manifest.shards) {
    const path = `${month}.json`;
    const bytes = encode.encode(JSON.stringify(months[month]));
    await write(path, bytes, "application/json");
    fileMetadata.push({ path, size: bytes.byteLength, sha256: await backupDigest(bytes) });
    delete months[month];
  }
  const completeManifest = { ...manifest, snapshotId: id, files: fileMetadata };
  const manifestBytes = encode.encode(JSON.stringify(completeManifest));
  const manifestHash = await backupDigest(manifestBytes);
  await write("manifest.json", manifestBytes, "application/json");
  return manifestHash;
}

const activeSnapshots = new Set<string>();

/** 目录按时间倒序列出。其他实例近一小时创建的未完成目录也预留上传时间。 */
async function trimRemoteBackups(target: RemoteTarget, id: string, published: boolean) {
  if (target.retentionCount === 0) return;
  const backups = (await listRemoteBackups(target)).filter(backup => backup.id <= id);
  const complete = backups.filter(backup => backup.complete && (!published || backup.id !== id));
  const completeSlots = target.retentionCount - Number(published);
  const incompleteSlots = Math.max(0, completeSlots - complete.length);
  const incomplete = backups.filter(backup => !backup.complete && (!published || backup.id !== id));
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString().replace(/[-:.]/g, "");
  for (const backup of incomplete.slice(incompleteSlots).reverse()) {
    if (backup.id !== id && (activeSnapshots.has(backup.id) || backup.id >= cutoff)) continue;
    await deleteRemoteBackup(target, backup.id, true);
  }
  if (published) {
    for (const backup of complete.slice(completeSlots).reverse()) await deleteRemoteBackup(target, backup.id);
  }
}

/** 推送一次：建立独立快照目录，先传内容与 manifest，最后写 COMPLETE。 */
export async function pushBackup(
  ctx: { db: SqlDatabase; userId: string; bucket: AttachmentBucket },
  target: RemoteTarget,
): Promise<RemoteBackupPushResult> {
  let writingId: string | null = null;
  try {
    const snapshot = await collectBackup(ctx.db, ctx.userId, ctx.bucket);
    const { manifest, missingAttachments } = snapshot;
    if (missingAttachments.length > 0) throw new Error(`备份失败：${missingAttachments.length} 个引用附件缺失（首例 ${missingAttachments[0]!.slice(0, 8)}…）`);
    const root = normalizeRemotePath(target.remotePath);
    const id = newSnapshotId();
    const directory = `${root}/${id}`;
    if (target.kind === "webdav") {
      // Create namespace and snapshot collection before PUT; DAV servers do not create parents implicitly.
      await ensureDavSnapshotDirectories(target, root, directory);
    }
    activeSnapshots.add(id);
    writingId = id;
    const manifestHash = await writeSnapshotFiles(ctx.bucket, snapshot, id,
      (path, bytes, mime) => remotePut(target, `${directory}/${path}`, bytes, mime));
    // Publish COMPLETE only after validating the actual remote payload.
    await verifyRemoteSnapshot(target, id, manifestHash);
    const markerPath = `${directory}/COMPLETE`;
    try {
      await remotePut(target, markerPath, new TextEncoder().encode(manifestHash), "text/plain");
      const marker = await remoteGet(target, markerPath, manifestHash.length);
      if (new TextDecoder().decode(marker) !== manifestHash) throw new Error("备份完成标记校验失败");
    } catch (error) {
      await removeCompleteMarker(target, id).catch(() => {});
      throw error;
    }
    // The new snapshot is durable even if the remote denies deletion. Keep its successful schedule.
    const result = { ok: true, shards: manifest.shards.length, backupId: id, missingAttachments } as const;
    try {
      await trimRemoteBackups(target, id, true);
      return result;
    } catch (error) {
      return { ...result, cleanupError: String(error).slice(0, 300) };
    }
  } catch (error) {
    if (writingId) {
      // 上传中断时只清理超额的未完成目录，完整快照留到成功推送后轮替。
      try { await trimRemoteBackups(target, writingId, false); }
      catch (cleanupError) { return { ok: false, error: `${String(error).slice(0, 150)}；清理失败：${String(cleanupError).slice(0, 120)}` }; }
    }
    return { ok: false, error: String(error).slice(0, 300) };
  } finally {
    if (writingId) activeSnapshots.delete(writingId);
  }
}

export { deleteRemoteBackup, listRemoteBackups, testRemoteTarget } from "./backupRemote";
