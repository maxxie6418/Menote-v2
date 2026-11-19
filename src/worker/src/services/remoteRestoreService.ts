import { restoreAttachmentStatement, realignAttachmentStatements } from "../db/attachments";
import { importBackupEntries } from "./restoreService";
import { readVerifiedRemoteSnapshot } from "./backupVerifyService";
import type { RemoteTarget } from "./backupRemote";

/** Read and verify the full snapshot before importing any content. */
export async function restoreRemoteSnapshot(
  ctx: { db: D1Database; userId: string; bucket: R2Bucket }, target: RemoteTarget, snapshotId: string,
) {
  const snapshot = await readVerifiedRemoteSnapshot(target, snapshotId);
  // Stage content-addressed objects first. If a later write fails, these have no metadata or references and remain inaccessible.
  for (const attachment of snapshot.attachmentFiles) await ctx.bucket.put(`${ctx.userId}/${attachment.sha256}`, attachment.bytes);
  const now = Date.now();
  const metadata = snapshot.attachmentFiles.flatMap(({ sha256, bytes, mime }) => [
    restoreAttachmentStatement(ctx.db, ctx.userId, sha256, bytes.byteLength, mime),
    ...realignAttachmentStatements(ctx.db, ctx.userId, sha256, now),
  ]);
  const imported = await importBackupEntries(
    { db: ctx.db, userId: ctx.userId }, snapshot.entries, snapshot.itemKeyWraps, snapshot.topicKeyWraps, snapshot.settings, now,
    { attachmentStatements: metadata, recoveryCodeBinding: snapshot.recoveryCodeBinding },
  );
  return { ...imported, attachments: snapshot.attachmentFiles.length };
}
