import type { Item } from "@menote/shared";
import { localDb } from "../db/localDb";
import { notifyLocalChange } from "../lib/broadcast";
import { encryptMarkdown, generateContentKey, generateRecoveryCode, wrapContentKey } from "./cryptoService";
import { getContentKey } from "./keyringService";
import { archiveVersionBeforeSave } from "./versionService";
import { enqueueWrite, outboxUpsert, packEnvelope, requireItem, unpackEnvelope } from "./contentShared";
import { attachmentHashesOf } from "../lib/attachmentRefs";
import { recordSyncDiagnostic } from "./syncDiagnosticsService";
import { cancelScheduledRecovery, discardRecovery } from "./recoveryService";
import { enforceRecoveryCode, withRecoveryCodeLock } from "./recoveryCodeService";

/** 单篇加密命令（G7，G4 设计；G10 整理自 contentService）。三凭据分离：登录密码不参与任何 KEK。 */
/** 单篇密码最少 6 位，不另加复杂度（负责人 2026-11-03）。与空间密码 4 位、登录口令 8 位都不同。 */
export const NOTE_PASSWORD_MIN = 6;

/** 启用单篇加密：生成内容密钥、密码+恢复码双包装（FR-ENC-2/6），写回密文并随操作携带包装块。
 *  未提供恢复码时自动生成并返回（明文仅此一次展示，永不入库）。 */
export function enableItemEncryption(
  userId: string, id: string, markdown: string, password: string, recoveryCode?: string,
): Promise<{ item: Item; recoveryCode: string; key: Uint8Array }> {
  return enqueueWrite(() => withRecoveryCodeLock(userId, () => enableItemEncryptionInner(userId, id, markdown, password, recoveryCode)));
}

async function enableItemEncryptionInner(
  userId: string, id: string, markdown: string, password: string, recoveryCode?: string,
): Promise<{ item: Item; recoveryCode: string; key: Uint8Array }> {
  if (password.length < NOTE_PASSWORD_MIN) throw new Error(`密码至少 ${NOTE_PASSWORD_MIN} 位`);
  const current = await requireItem(userId, id);
  if (current.type === "memo") throw new Error("memo_cannot_encrypt"); // FR-ENC-1：Memo 不入加密作用域
  if (current.content.scope !== "plain") throw new Error("already_encrypted");
  // 文件对象目前没有加密上传能力，不能对现有明文附件作出密文承诺。
  if (current.attachmentHashes.length > 0 || attachmentHashesOf(markdown).length > 0) {
    throw new Error("attachment_encryption_unsupported");
  }
  const key = generateContentKey();
  const code = await enforceRecoveryCode(userId, recoveryCode);
  const wraps = [
    await wrapContentKey(key, password, "password"),
    await wrapContentKey(key, code, "recovery"),
  ];
  const envelope = await encryptMarkdown(markdown, key);
  // 在事务外完成 WebCrypto（IndexedDB 事务不能跨任意异步操作），事务内再次核对
  // 快照没有变化后，与正文和 outbox 一起原子替换，保留历史和崩溃恢复能力。
  const versions = await localDb.versions.where("itemId").equals(id).and((row) => row.userId === userId).toArray();
  const recovery = await localDb.recovery.get(id);
  const sealedVersions = await Promise.all(versions.map(async (row) => {
    if (row.scope !== "plain") return row;
    const sealed = await encryptMarkdown(row.content, key);
    return { ...row, scope: "sealed" as const, content: packEnvelope(sealed.iv, sealed.ciphertext) };
  }));
  const sealedRecovery = recovery?.scope === "plain" && recovery.userId === userId
    ? await encryptMarkdown(recovery.content, key) : null;
  const next: Item = {
    ...current, rev: current.rev + 1, contentHash: "enc-" + envelope.ciphertext.slice(0, 16),
    attachmentHashes: [],
    updatedAt: Date.now(), content: { scope: "self", ciphertext: packEnvelope(envelope.iv, envelope.ciphertext) },
  };
  await localDb.transaction("rw", localDb.items, localDb.outbox, localDb.wraps, localDb.versions, localDb.recovery, async () => {
    const latest = await localDb.items.get(id);
    if (!latest || latest.userId !== userId || latest.rev !== current.rev || latest.metaRev !== current.metaRev || latest.contentHash !== current.contentHash || latest.content.scope !== "plain") throw new Error("encryption_item_changed");
    // 旧操作包含明文及服务端 rev 依赖，不可删除或改写；先同步再加密。
    const pending = await localDb.outbox.where("userId").equals(userId)
      .and((row) => row.entity === "item" && row.entityId === id).count();
    if (pending > 0) throw new Error("encryption_pending_sync");
    const latestVersions = await localDb.versions.where("itemId").equals(id).and((row) => row.userId === userId).toArray();
    const latestRecovery = await localDb.recovery.get(id);
    if (JSON.stringify(latestVersions) !== JSON.stringify(versions) || JSON.stringify(latestRecovery) !== JSON.stringify(recovery)) throw new Error("encryption_item_changed");
    if (sealedVersions.length) await localDb.versions.bulkPut(sealedVersions);
    if (sealedRecovery && recovery) await localDb.recovery.put({ ...recovery, scope: "sealed", content: packEnvelope(sealedRecovery.iv, sealedRecovery.ciphertext) });
    await localDb.items.put(next);
    await localDb.wraps.put({ itemId: id, wraps });
    // 正文变了（明文→密文）：必须带 contentHash，否则服务端按元数据写处理，正文版本号不推进。
    await localDb.outbox.add({ ...outboxUpsert(next, current.rev, current.metaRev, next.contentHash), wraps });
  });
  cancelScheduledRecovery(id);
  notifyLocalChange();
  return { item: next, recoveryCode: code, key };
}

/** 解锁态保存加密正文：以会话密钥重加密（密钥不落盘；包装块不变）。 */
export function saveEncryptedContent(userId: string, id: string, markdown: string): Promise<Item> {
  return enqueueWrite(async () => {
    const current = await requireItem(userId, id);
    if (current.type === "memo") throw new Error("memo_cannot_encrypt");
    const key = getContentKey(id);
    if (!key) throw new Error("locked");
    if (current.content.scope !== "self" && current.content.scope !== "private_space") {
      throw new Error("not_encrypted");
    }
    const attachmentHashes = attachmentHashesOf(markdown);
    // 禁止通过粘贴 Markdown 引用把明文附件引入加密内容；旧版遗留引用允许保留或移除。
    if (attachmentHashes.some((hash) => !current.attachmentHashes.includes(hash))) {
      throw new Error("加密笔记暂不支持新增附件引用");
    }
    const envelope = await encryptMarkdown(markdown, key);
    const sealed = packEnvelope(envelope.iv, envelope.ciphertext);
    if (sealed !== current.content.ciphertext) {
      await archiveVersionBeforeSave(userId, current, "autosave");
    }
    const next: Item = {
      ...current, rev: current.rev + 1, contentHash: "enc-" + envelope.ciphertext.slice(0, 16),
      attachmentHashes,
      updatedAt: Date.now(), content: { scope: current.content.scope, ciphertext: sealed },
    };
    await localDb.transaction("rw", localDb.items, localDb.outbox, async () => {
      await localDb.items.put(next);
      // 重加密后正文哈希变了：按正文操作上报，正文版本号随之推进。
      await localDb.outbox.add(outboxUpsert(next, current.rev, current.metaRev, next.contentHash));
    });
    await discardRecovery(id);
    recordSyncDiagnostic(userId, {
      category: "local", event: "encrypted_note_content_saved_locally", entity: "item", entityId: id,
      action: "upsert", baseRev: current.rev, baseMetaRev: current.metaRev,
    });
    notifyLocalChange();
    return next;
  });
}

/** 解密为明文形态（移除单篇加密）：包装块本地清除，服务端旧行随清理期滚动（无害残留）。 */
export function decryptToPlain(userId: string, id: string, markdown: string): Promise<Item> {
  return enqueueWrite(() => decryptToPlainInner(userId, id, markdown));
}

async function decryptToPlainInner(userId: string, id: string, markdown: string): Promise<Item> {
  const current = await requireItem(userId, id);
  if (current.content.scope === "self" && markdown.trim() === "") {
    const sealed = current.content.ciphertext;
    if (sealed.length > 0) {
      const { readPlain } = await import("./keyringService");
      const plain = await readPlain(id, unpackEnvelope(sealed));
      if (plain === null) throw new Error("decrypt_failed");
      if (plain.trim() !== "") throw new Error("decrypt_empty");
    }
  }
  if (current.content.scope === "private_space") throw new Error("私人空间笔记不能转为明文");
  const next: Item = {
    ...current, rev: current.rev + 1, contentHash: await (async () => {
      const { sha256Hex } = await import("../lib/hash");
      return sha256Hex(markdown);
    })(),
    attachmentHashes: attachmentHashesOf(markdown),
    updatedAt: Date.now(), content: { scope: "plain", markdown },
  };
  await localDb.transaction("rw", localDb.items, localDb.outbox, localDb.wraps, async () => {
    await localDb.items.put(next);
    await localDb.wraps.delete(id);
    await localDb.outbox.add(outboxUpsert(next, current.rev, current.metaRev, next.contentHash));
  });
  notifyLocalChange();
  return next;
}

/** 供 UI 解析加密信封（iv:ciphertext 运行时格式）。 */
export function parseEnvelope(sealed: string): { iv: string; ciphertext: string } {
  return unpackEnvelope(sealed);
}

export const encryptionHelpers = { generateRecoveryCode };
