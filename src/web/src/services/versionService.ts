import type { Item } from "@menote/shared";
import { localDb, type VersionRow } from "../db/localDb";
import { notifyLocalChange } from "../lib/broadcast";
import { sha256Hex } from "../lib/hash";
import { enqueueWrite, outboxUpsert, packEnvelope, requireItem, unpackEnvelope } from "./contentShared";
import { getContentKey } from "./keyringService";
import { decryptMarkdown, encryptMarkdown } from "./cryptoService";
import { attachmentHashesOf } from "../lib/attachmentRefs";
import { verifyAddedSealedAttachments } from "./sealedAttachmentService";

/** 版本历史与回收站（G8，FR-VER-1~7；G10 整理自 contentService）。 */

export type { VersionRow };
export type VersionRowReason = "autosave" | "session" | "restore" | "manual";

const VERSION_KEEP_PER_ITEM = 50;
const VERSION_KEEP_PER_USER = 2000;
const VERSION_MIN_INTERVAL_MS = 10 * 60_000;

/** 封存当前稿（写入前调用）。节流：同条目 10 分钟内不重复封存（autosave 空闲语义的简化实现）。
 *  加密条目只存信封字符串（FR-VER-5；M1 schema 明文/密文互斥同构）。 */
export async function archiveVersionBeforeSave(userId: string, item: Item, reason: VersionRowReason = "autosave"): Promise<void> {
  if (item.type === "memo" && item.content.scope === "plain" && item.content.markdown === "") return;
  const last = await localDb.versions.where("itemId").equals(item.id).last();
  if (last && Date.now() - last.createdAt < VERSION_MIN_INTERVAL_MS) return;
  const sealed = item.content.scope !== "plain";
  await localDb.versions.add({
    itemId: item.id, userId, title: item.title ?? "",
    content: item.content.scope === "plain" ? item.content.markdown : item.content.ciphertext,
    scope: sealed ? "sealed" : "plain", rev: item.rev, reason, createdAt: Date.now(),
  });
  await trimVersions(userId, item.id);
}

async function trimVersions(userId: string, itemId: string): Promise<void> {
  const mine = await localDb.versions.where("itemId").equals(itemId).toArray();
  if (mine.length > VERSION_KEEP_PER_ITEM) {
    const outdated = mine.sort((a, b) => a.createdAt - b.createdAt).slice(0, mine.length - VERSION_KEEP_PER_ITEM);
    await localDb.versions.bulkDelete(outdated.map((row) => row.id!).filter(Boolean));
  }
  const all = await localDb.versions.where("userId").equals(userId).toArray();
  if (all.length > VERSION_KEEP_PER_USER) {
    const outdated = all.sort((a, b) => a.createdAt - b.createdAt).slice(0, all.length - VERSION_KEEP_PER_USER);
    await localDb.versions.bulkDelete(outdated.map((row) => row.id!).filter(Boolean));
  }
}

export async function listVersions(itemId: string) {
  const rows = await localDb.versions.where("itemId").equals(itemId).toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

/** 恢复版本（FR-VER-1）：先封存当前稿，再以历史内容写回（明文走统一保存链路）。 */
export async function restoreVersion(userId: string, itemId: string, versionId: number): Promise<Item> {
  return enqueueWrite(() => restoreVersionInner(userId, itemId, versionId));
}

async function restoreVersionInner(userId: string, itemId: string, versionId: number): Promise<Item> {
  const current = await requireItem(userId, itemId);
  const version = await localDb.versions.get(versionId);
  if (!version || version.itemId !== itemId || version.userId !== userId) throw new Error("version_not_found");

  let markdown: string;
  let nextContent: Item["content"];
  let contentHash: string;
  let sessionKey: Uint8Array | undefined;
  if (version.scope === "plain") {
    if (current.content.scope !== "plain") throw new Error("scope_mismatch");
    markdown = version.content;
    contentHash = await sha256Hex(markdown);
    nextContent = { scope: "plain", markdown };
  } else {
    if (current.content.scope === "plain" || current.type === "memo") throw new Error("scope_mismatch");
    const key = getContentKey(itemId);
    if (!key) throw new Error("locked");
    sessionKey = key;
    // 先验证并解开历史信封；错误密钥或损坏数据不能改变当前稿或生成恢复记录。
    markdown = await decryptMarkdown(unpackEnvelope(version.content), key);
    try {
      await verifyAddedSealedAttachments(itemId, attachmentHashesOf(markdown), current.attachmentHashes);
    } catch {
      if (getContentKey(itemId) !== key) throw new Error("locked");
      throw new Error("历史附件无法验证为密文。请在解锁后先加密旧附件，再恢复此版本。");
    }
    const envelope = await encryptMarkdown(markdown, key);
    contentHash = "enc-" + envelope.ciphertext.slice(0, 16);
    nextContent = { scope: current.content.scope, ciphertext: packEnvelope(envelope.iv, envelope.ciphertext) };
  }
  const next = {
    ...current, rev: current.rev + 1, contentHash, attachmentHashes: attachmentHashesOf(markdown),
    updatedAt: Date.now(), content: nextContent,
  } as Item; // 上方已排除 Memo 密文和版本作用域不匹配。
  // 当前稿封存、写回和同步入队必须一起成功，且都在写队列中取最新状态。
  await localDb.transaction("rw", localDb.items, localDb.outbox, localDb.versions, async () => {
    // 写队列只覆盖当前页面；事务内复核其他标签页是否在解密期间修改了条目或历史。
    const latest = await localDb.items.get(itemId);
    const latestVersion = await localDb.versions.get(versionId);
    if (!latest || latest.userId !== userId || latest.rev !== current.rev || latest.metaRev !== current.metaRev ||
        latest.contentHash !== current.contentHash || !latestVersion || latestVersion.userId !== userId ||
        latestVersion.itemId !== itemId || latestVersion.scope !== version.scope || latestVersion.content !== version.content) {
      throw new Error("version_restore_changed");
    }
    await localDb.versions.add({
      itemId, userId, title: current.title ?? "", content: current.content.scope === "plain" ? current.content.markdown : current.content.ciphertext,
      scope: current.content.scope === "plain" ? "plain" : "sealed", rev: current.rev, reason: "restore", createdAt: Date.now(),
    });
    await localDb.items.put(next);
    await localDb.outbox.add(outboxUpsert(next, current.rev, current.metaRev, next.contentHash));
    if (sessionKey && getContentKey(itemId) !== sessionKey) throw new Error("locked");
  });
  notifyLocalChange();
  return next;
}

/** 回收站恢复（FR-VER-6）：清除墓碑并以 upsert 传播。
 *  正文没变，属元数据写：本地与服务端同步推进 meta_rev，版本号才不会错位。 */
export async function restoreFromTrash(userId: string, id: string): Promise<void> {
  const current = await requireItem(userId, id);
  if (current.deletedAt === null) return;
  const next: Item = { ...current, deletedAt: null, metaRev: current.metaRev + 1 };
  await localDb.transaction("rw", localDb.items, localDb.outbox, async () => {
    await localDb.items.put(next);
    await localDb.outbox.add(outboxUpsert(next, current.rev, current.metaRev));
  });
  notifyLocalChange();
}

/** 永久删除：先确认服务端硬删，再清本地。网络失败保留本地行，避免软删记录被拉回时对不上。 */
export async function purgeItemsPermanently(userId: string, ids: string[]): Promise<void> {
  const response = await fetch("/api/trash/purge", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }), cache: "no-store",
  });
  if (!response.ok) throw new Error(`purge_${response.status}`);
  await localDb.transaction("rw", localDb.items, localDb.memoComments, localDb.outbox, localDb.wraps, localDb.versions, async () => {
    for (const id of ids) {
      await localDb.items.delete(id);
      const comments = await localDb.memoComments.where("memoId").equals(id).toArray();
      await localDb.memoComments.bulkDelete(comments.map((comment) => comment.id));
      await localDb.wraps.delete(id);
      const versions = await localDb.versions.where("itemId").equals(id).toArray();
      await localDb.versions.bulkDelete(versions.map((row) => row.id!).filter(Boolean));
    }
  });
  notifyLocalChange();
  void userId;
}
