import { bytesToBase64, encodeBackupRow } from "@menote/shared";
import { collectBackupRows } from "../db/backup";
import { deleteRemoteBackup, ensureDavSnapshotDirectories, listRemoteBackups, newSnapshotId, normalizeRemotePath, remotePut, type RemoteTarget } from "./backupRemote";
import { verifyRemoteSnapshot } from "./backupVerifyService";

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

/** 收集当前状态；引用附件缺失时记录清单，推送前拒绝生成不可恢复的快照。 */
export async function collectBackup(db: D1Database, userId: string, bucket: R2Bucket): Promise<{ months: Record<string, unknown[]>; manifest: Record<string, unknown>; attachments: Array<{ key: string; bytes: ArrayBuffer; mime: string }>; missingAttachments: string[] }> {
  const { items, topics, memoComments, itemKeyWraps, topicKeyWraps, settings, attachmentHashes, attachmentMimes, recoveryCodeBinding } = await collectBackupRows(db, userId);
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
  const attachments: Array<{ key: string; bytes: ArrayBuffer; mime: string }> = [];
  const missingAttachments: string[] = [];
  for (const sha256 of attachmentHashes) {
    const object = await bucket.get(`${userId}/${sha256}`);
    if (!object) { missingAttachments.push(sha256); continue; }
    attachments.push({ key: `attachments/${sha256}`, bytes: await object.arrayBuffer(), mime: attachmentMimes.get(sha256) ?? "application/octet-stream" });
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

/** 推送一次：建立独立快照目录，先传内容与 manifest，最后写 COMPLETE。 */
export async function pushBackup(
  ctx: { db: D1Database; userId: string; bucket: R2Bucket },
  target: RemoteTarget,
): Promise<{ ok: true; shards: number; backupId: string; missingAttachments: string[] } | { ok: false; error: string }> {
  try {
    const { months, manifest, attachments, missingAttachments } = await collectBackup(ctx.db, ctx.userId, ctx.bucket);
    if (missingAttachments.length > 0) throw new Error(`备份失败：${missingAttachments.length} 个引用附件缺失（首例 ${missingAttachments[0]!.slice(0, 8)}…）`);
    const root = normalizeRemotePath(target.remotePath);
    const id = newSnapshotId();
    const directory = `${root}/${id}`;
    if (target.kind === "webdav") {
      // Create namespace and snapshot collection before PUT; DAV servers do not create parents implicitly.
      await ensureDavSnapshotDirectories(target, root, directory);
    }
    const files: Array<{ path: string; bytes: Uint8Array; contentType: string }> = [];
    for (const attachment of attachments) files.push({ path: `attachment-${attachment.key.split("/").pop()}`, bytes: new Uint8Array(attachment.bytes), contentType: attachment.mime });
    for (const month of Object.keys(months).sort()) files.push({ path: `${month}.json`, bytes: new TextEncoder().encode(JSON.stringify(months[month])), contentType: "application/json" });
    const fileMetadata = await Promise.all(files.map(async (file) => ({
      path: file.path, size: file.bytes.byteLength, sha256: await hashHex(file.bytes),
      ...(file.path.startsWith("attachment-") ? { mime: file.contentType } : {}),
    })));
    const completeManifest = { ...manifest, snapshotId: id, files: fileMetadata };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(completeManifest));
    const manifestHash = await hashHex(manifestBytes);
    for (const file of files) await remotePut(target, `${directory}/${file.path}`, file.bytes, file.contentType);
    await remotePut(target, `${directory}/manifest.json`, manifestBytes, "application/json");
    await remotePut(target, `${directory}/COMPLETE`, new TextEncoder().encode(manifestHash), "text/plain");
    // 远端实际读回并校验通过之前，绝不清理已有快照。
    await verifyRemoteSnapshot(target, id);
    if (target.retentionCount > 0) {
      // 只清理严格更早的快照，避免两个并发推送互相删除刚验证的快照。
      const backups = (await listRemoteBackups(target)).filter((backup) => backup.complete && backup.id < id);
      for (const old of backups.slice(target.retentionCount - 1)) await deleteRemoteBackup(target, old.id);
    }
    return { ok: true, shards: Object.keys(months).length, backupId: id, missingAttachments };
  } catch (error) {
    return { ok: false, error: String(error).slice(0, 300) };
  }
}

function hashHex(bytes: Uint8Array): Promise<string> {
  return crypto.subtle.digest("SHA-256", bytes as BufferSource).then((digest) =>
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""));
}

export { deleteRemoteBackup, listRemoteBackups, testRemoteTarget } from "./backupRemote";
