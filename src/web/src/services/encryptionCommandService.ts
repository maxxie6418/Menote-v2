import type { Item } from "@menote/shared";
import { localDb } from "../db/localDb";
import { notifyLocalChange } from "../lib/broadcast";
import { decryptMarkdown, encryptMarkdown, generateContentKey, generateRecoveryCode, wrapContentKey } from "./cryptoService";
import { getContentKey } from "./keyringService";
import { archiveVersionBeforeSave } from "./versionService";
import { enqueueWrite, outboxUpsert, packEnvelope, requireItem, unpackEnvelope } from "./contentShared";
import { attachmentHashesOf, replaceAttachmentHashes } from "../lib/attachmentRefs";
import { recordSyncDiagnostic } from "./syncDiagnosticsService";
import { cancelScheduledRecovery, discardRecovery } from "./recoveryService";
import { registerRecoveryCode, withRecoveryCodeLock } from "./recoveryCodeService";
import { sealLegacyAttachments, verifyAddedSealedAttachments } from "./sealedAttachmentService";
import { notifyEditorChange, registerEditorSave } from "./editorSaveService";

/** 单篇加密命令（G7，G4 设计；G10 整理自 contentService）。三凭据分离：登录密码不参与任何 KEK。 */
/** 单篇密码最少 6 位，不另加复杂度（负责人 2026-11-03）。与空间密码 4 位、登录口令 8 位都不同。 */
export const NOTE_PASSWORD_MIN = 6;

/** 启用单篇加密：生成内容密钥、密码+恢复码双包装（FR-ENC-2/6），写回密文并随操作携带包装块。
 *  未提供恢复码时自动生成并返回（明文仅此一次展示，永不入库）。 */
export function enableItemEncryption(
  userId: string, id: string, markdown: string, password: string, recoveryCode?: string,
  options: { migrateAttachments?: boolean; expectedItem?: Item } = {},
): Promise<{ item: Item; recoveryCode: string; key: Uint8Array }> {
  return withPendingEncryption(userId, () => withRecoveryCodeLock(userId,
    () => enableItemEncryptionInner(userId, id, markdown, password, recoveryCode, options)));
}

async function enableItemEncryptionInner(
  userId: string, id: string, markdown: string, password: string, recoveryCode: string | undefined,
  options: { migrateAttachments?: boolean; expectedItem?: Item },
): Promise<{ item: Item; recoveryCode: string; key: Uint8Array }> {
  if (password.length < NOTE_PASSWORD_MIN) throw new Error(`密码至少 ${NOTE_PASSWORD_MIN} 位`);
  const current = await requireItem(userId, id);
  if (options.expectedItem && !sameNoteRevision(current, options.expectedItem)) throw new Error("encryption_item_changed");
  if (current.type === "memo") throw new Error("memo_cannot_encrypt"); // FR-ENC-1：Memo 不入加密作用域
  if (current.content.scope !== "plain") throw new Error("already_encrypted");
  await requireSyncedNote(userId, id);
  const source = await localEncryptionCopies(current);
  if (!options.migrateAttachments) {
    const plainCopies = [markdown, ...source.versions.filter((row) => row.scope === "plain").map((row) => row.content)];
    if (source.recovery?.scope === "plain") plainCopies.push(source.recovery.content);
    if (plainCopies.some((value) => attachmentHashesOf(value).length > 0)) throw new Error("attachment_migration_confirmation_required");
  }
  const key = generateContentKey();
  const { code, bindingId } = await registerRecoveryCode(userId, recoveryCode);
  const wraps = [
    await wrapContentKey(key, password, "password"),
    { ...await wrapContentKey(key, code, "recovery"), recoveryCodeId: bindingId },
  ];
  const copies = await prepareEncryptionCopies(current, markdown, key, source);
  const next = await encryptedRevision(current, copies.markdown, key, "self");
  await enqueueWrite(() => localDb.transaction("rw", localDb.items, localDb.outbox, localDb.wraps, localDb.versions, localDb.recovery, async () => {
    await requireSameNote(current);
    await requireSyncedNote(userId, id);
    await commitEncryptionCopies(current, copies);
    await localDb.items.put(next);
    await localDb.wraps.put({ itemId: id, wraps });
    // 正文变了（明文→密文）：必须带 contentHash，否则服务端按元数据写处理，正文版本号不推进。
    await localDb.outbox.add({ ...outboxUpsert(next, current.rev, current.metaRev, next.contentHash), wraps });
  }));
  cancelScheduledRecovery(id);
  notifyLocalChange();
  return { item: next, recoveryCode: code, key };
}

/** 仅由解锁界面的显式确认触发。只用已持久化的正文，编辑器先保存或中止。 */
export function migrateEncryptedAttachments(userId: string, expected: Item) {
  return withPendingEncryption(userId, async () => {
    const current = await requireSameNote(expected);
    if (current.userId !== userId || current.content.scope === "plain") throw new Error("not_encrypted");
    const id = current.id;
    const key = getContentKey(id);
    if (!key) throw new Error("locked");
    const ensureCurrent = () => { if (getContentKey(id) !== key) throw new Error("locked"); };
    const markdown = await decryptMarkdown(unpackEnvelope(current.content.ciphertext), key);
    const source = await localEncryptionCopies(current);
    const copies = await prepareEncryptionCopies(current, markdown, key, source, ensureCurrent);
    const next = copies.markdown === markdown ? null : await encryptedRevision(current, copies.markdown, key, current.content.scope);
    await enqueueWrite(() => localDb.transaction("rw", localDb.items, localDb.outbox, localDb.versions, localDb.recovery, async () => {
      await requireSameNote(current);
      await commitEncryptionCopies(current, copies);
      ensureCurrent();
      if (next) {
        await localDb.items.put(next);
        await localDb.outbox.add(outboxUpsert(next, current.rev, current.metaRev, next.contentHash));
      }
      ensureCurrent();
    }));
    cancelScheduledRecovery(id);
    if (copies.count) notifyLocalChange();
    return { markdown: copies.markdown, count: copies.count };
  });
}

async function withPendingEncryption<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  const unregister = registerEditorSave(userId, async () => false);
  notifyEditorChange();
  try { return await operation(); }
  finally { unregister(); notifyEditorChange(); }
}

async function requireSyncedNote(userId: string, id: string) {
  // 旧操作包含明文和 rev 依赖；先同步，不能重写或跳过。
  const pending = await localDb.outbox.where("userId").equals(userId)
    .and((row) => row.entity === "item" && row.entityId === id).count();
  if (pending > 0) throw new Error("encryption_pending_sync");
}

async function requireSameNote(expected: Item): Promise<Item> {
  const latest = await localDb.items.get(expected.id);
  if (!latest || !sameNoteRevision(latest, expected)) throw new Error("encryption_item_changed");
  return latest;
}

function sameNoteRevision(left: Item, right: Item): boolean {
  return left.id === right.id && left.userId === right.userId && left.rev === right.rev && left.metaRev === right.metaRev &&
    left.contentHash === right.contentHash && left.content.scope === right.content.scope;
}

async function localEncryptionCopies(item: Item) {
  const [versions, recovery] = await Promise.all([
    localDb.versions.where("itemId").equals(item.id).and((row) => row.userId === item.userId).toArray(),
    localDb.recovery.get(item.id),
  ]);
  return { versions, recovery: recovery?.userId === item.userId ? recovery : undefined };
}

async function encryptedRevision(item: Item, markdown: string, key: Uint8Array, scope: "self" | "private_space"): Promise<Item> {
  if (item.type === "memo") throw new Error("memo_cannot_encrypt");
  const envelope = await encryptMarkdown(markdown, key);
  return {
    ...item, rev: item.rev + 1, contentHash: "enc-" + envelope.ciphertext.slice(0, 16),
    attachmentHashes: attachmentHashesOf(markdown), updatedAt: Date.now(),
    content: { scope, ciphertext: packEnvelope(envelope.iv, envelope.ciphertext) },
  };
}

/** 先完成网络 I/O 与加密，待快照复核后统一写回。 */
async function prepareEncryptionCopies(item: Item, markdown: string, key: Uint8Array,
  source: Awaited<ReturnType<typeof localEncryptionCopies>>, ensureCurrent = () => {}) {
  const snapshots = [...source.versions, ...(source.recovery ? [source.recovery] : [])];
  const texts = await Promise.all(snapshots.map(async (row) => {
    if (row.scope === "plain") return row.content;
    // 重新启用单篇加密时，保留前次加密遗下的旧密钥快照。
    if (item.content.scope === "plain") return null;
    try { return await decryptMarkdown(unpackEnvelope(row.content), key); }
    catch { throw new Error("attachment_migration_snapshot_unavailable"); }
  }));
  const hashes = [...new Set([markdown, ...texts].flatMap((value) => value === null ? [] : attachmentHashesOf(value)))];
  const replacements = await sealLegacyAttachments(hashes, key, ensureCurrent);
  const protect = async <T extends { scope: "plain" | "sealed"; content: string }>(row: T, text: string | null): Promise<T> => {
    if (text === null) return row;
    const updated = replaceAttachmentHashes(text, replacements);
    if (row.scope === "sealed" && text === updated) return row;
    const sealed = await encryptMarkdown(updated, key);
    return { ...row, scope: "sealed", content: packEnvelope(sealed.iv, sealed.ciphertext) };
  };
  const versions = await Promise.all(source.versions.map((row, index) => protect(row, texts[index]!)));
  const recovery = source.recovery ? await protect(source.recovery, texts[source.versions.length]!) : undefined;
  return { source, versions, recovery, markdown: replaceAttachmentHashes(markdown, replacements), count: replacements.size };
}

async function commitEncryptionCopies(item: Item, copies: Awaited<ReturnType<typeof prepareEncryptionCopies>>) {
  const latest = await localEncryptionCopies(item);
  if (JSON.stringify(latest) !== JSON.stringify(copies.source)) throw new Error("encryption_item_changed");
  const changedVersions = copies.versions.filter((row, index) => row !== copies.source.versions[index]);
  if (changedVersions.length) await localDb.versions.bulkPut(changedVersions);
  if (copies.recovery && copies.recovery !== copies.source.recovery) await localDb.recovery.put(copies.recovery);
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
    await verifyAddedSealedAttachments(id, attachmentHashes, current.attachmentHashes);
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
      const latest = await localDb.items.get(id);
      if (getContentKey(id) !== key || !latest || latest.rev !== current.rev || latest.metaRev !== current.metaRev ||
          latest.contentHash !== current.contentHash || latest.content.scope !== current.content.scope) {
        throw new Error("笔记已锁定或有其他修改，请重新打开后重试。");
      }
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
  if (!getContentKey(id)) throw new Error("locked");
  // Moving sealed references to a clear note would remove the key and break its attachments.
  if (attachmentHashesOf(markdown).length) throw new Error("请先导出笔记与附件，再移除附件引用并解除加密。");
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
