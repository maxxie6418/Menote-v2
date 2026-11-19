import { publishAttachmentStatements, realignAttachmentStatements } from "../db/attachments";
import { importBackupEntries } from "./restoreService";
import { readVerifiedRemoteSnapshot } from "./backupVerifyService";
import type { RemoteTarget } from "./backupRemote";
import { stageAttachmentObjects } from "./attachmentService";

/** Read and verify the full snapshot before importing any content. */
export async function restoreRemoteSnapshot(
  ctx: { db: D1Database; userId: string; bucket: R2Bucket }, target: RemoteTarget, snapshotId: string,
) {
  const snapshot = await readVerifiedRemoteSnapshot(target, snapshotId);
  const now = Date.now();
  const attachmentPublications: D1PreparedStatement[] = [];
  const attachmentStatements: D1PreparedStatement[] = [];
  for (const { sha256, bytes, mime, key } of await stageAttachmentObjects(ctx, ctx.userId, snapshot.attachmentFiles)) {
    attachmentPublications.push(...publishAttachmentStatements(ctx.db, ctx.userId, sha256, bytes.byteLength, mime, key, now));
    attachmentStatements.push(...realignAttachmentStatements(ctx.db, ctx.userId, sha256, now));
  }
  const imported = await importBackupEntries(
    { db: ctx.db, userId: ctx.userId }, snapshot.entries, snapshot.itemKeyWraps, snapshot.topicKeyWraps, snapshot.settings, now,
    { attachmentPublications, attachmentStatements, recoveryCodeBinding: snapshot.recoveryCodeBinding },
  );
  return { ...imported, attachments: snapshot.attachmentFiles.length };
}
