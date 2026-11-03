import type { Item } from "@menote/shared";
import { localDb } from "../db/localDb";
import { notifyLocalChange } from "../lib/broadcast";
import { encryptMarkdown, generateContentKey, generateRecoveryCode, wrapContentKey } from "./cryptoService";
import { getContentKey } from "./keyringService";
import { archiveVersionBeforeSave } from "./versionService";
import { enqueueWrite, outboxUpsert, packEnvelope, requireItem, unpackEnvelope } from "./contentShared";

/** 单篇加密命令（G7，G4 设计；G10 整理自 contentService）。三凭据分离：登录密码不参与任何 KEK。 */

/** 启用单篇加密：生成内容密钥、密码+恢复码双包装（FR-ENC-2/6），写回密文并随操作携带包装块。
 *  未提供恢复码时自动生成并返回（明文仅此一次展示，永不入库）。 */
export async function enableItemEncryption(
  userId: string, id: string, markdown: string, password: string, recoveryCode?: string,
): Promise<{ item: Item; recoveryCode: string; key: Uint8Array }> {
  const current = await requireItem(userId, id);
  if (current.type === "memo") throw new Error("memo_cannot_encrypt"); // FR-ENC-1：Memo 不入加密作用域
  const key = generateContentKey();
  const code = recoveryCode ?? generateRecoveryCode();
  const wraps = [
    await wrapContentKey(key, password, "password"),
    await wrapContentKey(key, code, "recovery"),
  ];
  const envelope = await encryptMarkdown(markdown, key);
  const next: Item = {
    ...current, rev: current.rev + 1, contentHash: "enc-" + envelope.ciphertext.slice(0, 16),
    updatedAt: Date.now(), content: { scope: "self", ciphertext: packEnvelope(envelope.iv, envelope.ciphertext) },
  };
  await localDb.transaction("rw", localDb.items, localDb.outbox, localDb.wraps, async () => {
    await localDb.items.put(next);
    await localDb.wraps.put({ itemId: id, wraps });
    await localDb.outbox.add({ ...outboxUpsert(next, current.rev, current.metaRev), wraps });
  });
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
    const envelope = await encryptMarkdown(markdown, key);
    const sealed = packEnvelope(envelope.iv, envelope.ciphertext);
    if (sealed !== current.content.ciphertext) {
      await archiveVersionBeforeSave(userId, current, "autosave");
    }
    const next: Item = {
      ...current, rev: current.rev + 1, contentHash: "enc-" + envelope.ciphertext.slice(0, 16),
      updatedAt: Date.now(), content: { scope: current.content.scope, ciphertext: sealed },
    };
    await localDb.transaction("rw", localDb.items, localDb.outbox, async () => {
      await localDb.items.put(next);
      await localDb.outbox.add(outboxUpsert(next, current.rev, current.metaRev));
    });
    notifyLocalChange();
    return next;
  });
}

/** 解密为明文形态（移除单篇加密）：包装块本地清除，服务端旧行随清理期滚动（无害残留）。 */
export async function decryptToPlain(userId: string, id: string, markdown: string): Promise<Item> {
  const current = await requireItem(userId, id);
  if (current.content.scope === "private_space") throw new Error("私人空间笔记不能转为明文");
  const next: Item = {
    ...current, rev: current.rev + 1, contentHash: await (async () => {
      const { sha256Hex } = await import("../lib/hash");
      return sha256Hex(markdown);
    })(),
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
