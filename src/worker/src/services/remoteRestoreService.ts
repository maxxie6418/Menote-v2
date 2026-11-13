import { upsertAttachment, setAttachmentRefs, countAttachmentRefs } from "../db/attachments";
import { importBackupEntries } from "./restoreService";
import { readVerifiedRemoteSnapshot } from "./backupVerifyService";
import type { RemoteTarget } from "./backupRemote";

/** Read and verify the full snapshot before importing any content. */
export async function restoreRemoteSnapshot(
  ctx: { db: D1Database; userId: string; bucket: R2Bucket }, target: RemoteTarget, snapshotId: string,
) {
  const snapshot = await readVerifiedRemoteSnapshot(target, snapshotId);
  if (snapshot.entries.length > 5000) throw new Error("此快照超过单次恢复上限，请分批恢复功能上线后再操作");
  // Stage content-addressed objects first. If a later write fails, these have no metadata or references and remain inaccessible.
  for (const attachment of snapshot.attachmentFiles) await ctx.bucket.put(`${ctx.userId}/${attachment.sha256}`, attachment.bytes);
  const imported = await importBackupEntries(
    { db: ctx.db, userId: ctx.userId }, snapshot.entries, snapshot.itemKeyWraps, snapshot.topicKeyWraps, snapshot.settings, Date.now(),
  );
  for (const attachment of snapshot.attachmentFiles) {
    await upsertAttachment(ctx.db, ctx.userId, attachment.sha256, attachment.bytes.byteLength, "application/octet-stream");
    await setAttachmentRefs(ctx.db, ctx.userId, attachment.sha256, await countAttachmentRefs(ctx.db, ctx.userId, attachment.sha256));
  }
  return { ...imported, attachments: snapshot.attachmentFiles.length };
}
