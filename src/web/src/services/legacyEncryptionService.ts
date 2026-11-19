import { localDb } from "../db/localDb";
import { decryptMarkdown, encryptMarkdown } from "./cryptoService";
import { packEnvelope, unpackEnvelope } from "./contentShared";

/** 旧版加密前封存的明文仍在本机；凭本次解锁的内容密钥原子密封并保留。 */
export async function sealLegacyLocalContent(itemId: string, key: Uint8Array): Promise<void> {
  const item = await localDb.items.get(itemId);
  if (!item || item.content.scope === "plain") return;
  const originalCiphertext = item.content.ciphertext;
  const versions = await localDb.versions.where("itemId").equals(itemId).and((row) => row.userId === item.userId).toArray();
  const recovery = await localDb.recovery.get(itemId);
  if (!versions.some((row) => row.scope === "plain") && !(recovery?.userId === item.userId && recovery.scope === "plain")) return;
  // 包装块和正文可能因旧版本或同步故障不匹配。先验证密钥，不能用错误密钥改写可恢复的历史。
  await decryptMarkdown(unpackEnvelope(originalCiphertext), key);
  const sealedVersions = await Promise.all(versions.map(async (row) => {
    if (row.scope !== "plain") return row;
    const sealed = await encryptMarkdown(row.content, key);
    return { ...row, scope: "sealed" as const, content: packEnvelope(sealed.iv, sealed.ciphertext) };
  }));
  const sealedRecovery = recovery?.userId === item.userId && recovery.scope === "plain"
    ? await encryptMarkdown(recovery.content, key) : null;
  await localDb.transaction("rw", localDb.items, localDb.versions, localDb.recovery, async () => {
    const latest = await localDb.items.get(itemId);
    const latestVersions = await localDb.versions.where("itemId").equals(itemId).and((row) => row.userId === item.userId).toArray();
    const latestRecovery = await localDb.recovery.get(itemId);
    if (!latest || latest.userId !== item.userId || latest.content.scope === "plain" || latest.content.scope !== item.content.scope || latest.content.ciphertext !== originalCiphertext || JSON.stringify(latestVersions) !== JSON.stringify(versions) || JSON.stringify(latestRecovery) !== JSON.stringify(recovery)) {
      throw new Error("encryption_item_changed");
    }
    if (sealedVersions.length) await localDb.versions.bulkPut(sealedVersions);
    if (sealedRecovery && recovery) await localDb.recovery.put({ ...recovery, scope: "sealed", content: packEnvelope(sealedRecovery.iv, sealedRecovery.ciphertext) });
  });
}
