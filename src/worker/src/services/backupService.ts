import { AwsClient } from "aws4fetch";
import { collectBackupRows } from "../db/backup";

/**
 * 备份服务（G9，FR-BAK-1~8；备份专项设计=管理线计划 G9 定稿）：
 * - 快照模型：当前完整状态按月分片（一月一片 JSON）+ manifest（版本与哈希）+ COMPLETE 标记；
 *   无重放链；老月份变更重推其分片（实现口径：每次推送重算全部月份分片并逐片 PUT，天然覆盖变更重推）。
 * - 备份包 = 结构化 JSON（含加密条目密文与包装块）+ 附件（按引用打包）+ manifest；主密码/明文恢复码绝不入包（FR-BAK-5）。
 * - append_only 绝不产生远端删除（FR-BAK-4）。
 * - 凭据：AUTH_PEPPER 派生密钥做可逆加密存储（C-7 复显口径；与内容密钥无关，G4 差异注记）。
 */

export interface TargetInput {
  kind: "s3" | "webdav";
  endpoint: string;
  bucket: string | null;
  username: string | null;
  secret: string;
}

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
  const { items, topics, itemKeyWraps, topicKeyWraps, settings, attachmentHashes } = await collectBackupRows(db, userId);
  const months: Record<string, unknown[]> = {};
  const monthOf = (timestamp: unknown): string => {
    const date = new Date(typeof timestamp === "number" ? timestamp : Number(timestamp ?? 0));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  for (const item of items) {
    (months[monthOf(item.created_at)] ??= []).push({ kind: "item", data: item });
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
    counts: { items: items.length, topics: topics.length, attachments: attachments.length },
    note: "加密条目为密文 + item_key_wraps 包装元数据；恢复需用户凭据（FR-BAK-5）",
  };
  return {
    months,
    manifest: { ...manifest, extra: { itemKeyWraps, topicKeyWraps, settings } },
    attachments,
  };
}

function shardKey(month: string): string {
  return `menote/${month}.json`;
}

/** 推送一次：逐分片 PUT → manifest PUT → COMPLETE 标记（双标记校验链，FR-BAK-7）。 */
export async function pushBackup(
  ctx: { db: D1Database; userId: string; bucket: R2Bucket },
  target: { kind: "s3" | "webdav"; endpoint: string; bucket: string | null; username: string | null; secret: string },
): Promise<{ ok: true; shards: number } | { ok: false; error: string }> {
  try {
    const { months, manifest, attachments } = await collectBackup(ctx.db, ctx.userId, ctx.bucket);
    const put = async (key: string, body: Uint8Array | string, contentType: string): Promise<void> => {
      if (target.kind === "webdav") {
        const url = `${target.endpoint.replace(/\/$/, "")}/${key}`;
        const response = await fetch(url, {
          method: "PUT", headers: {
            Authorization: `Basic ${btoa(`${target.username ?? ""}:${target.secret}`)}`, "Content-Type": contentType,
          }, body: body as BodyInit,
        });
        if (!response.ok) throw new Error(`webdav_put_${response.status}`);
        return;
      }
      const client = new AwsClient({ accessKeyId: target.username ?? "", secretAccessKey: target.secret });
      const base = target.endpoint.replace(/\/$/, "");
      const url = base.startsWith("http")
        ? (target.bucket ? `${base}/${target.bucket}/${key}` : `${base}/${key}`)
        : `https://s3.${base}.amazonaws.com/${target.bucket}/${key}`;
      const response = await client.fetch(url, { method: "PUT", body: body as BodyInit, headers: { "Content-Type": contentType } });
      if (!response.ok) throw new Error(`s3_put_${response.status}`);
    };

    // 附件随行（FR-BAK-6 备份包=JSON+附件+manifest）
    for (const attachment of attachments) {
      await put(attachment.key, new Uint8Array(attachment.bytes), "application/octet-stream");
    }
    for (const month of Object.keys(months).sort()) {
      await put(shardKey(month), JSON.stringify(months[month]), "application/json");
    }
    await put("menote/manifest.json", JSON.stringify(manifest), "application/json");
    await put("menote/COMPLETE", new Date().toISOString(), "text/plain");
    return { ok: true, shards: Object.keys(months).length };
  } catch (error) {
    return { ok: false, error: String(error).slice(0, 300) };
  }
}
