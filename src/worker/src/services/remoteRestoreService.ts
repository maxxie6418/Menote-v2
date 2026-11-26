import { archiveExtraStatements } from "../db/archiveExtras";
import { publishAttachmentStatements, realignAttachmentStatements } from "../db/attachments";
import { importBackupEntries } from "./restoreService";
import { readRemoteSnapshotMetadata, readVerifiedAttachment, type UploadedSnapshotSource } from "./backupVerifyService";
import type { RemoteTarget } from "./backupRemote";
import { reserveAttachmentStage } from "./attachmentService";

/** Verify each object before staging it and publish only after the entire snapshot is verified. */
export async function restoreRemoteSnapshot(
  ctx: { db: SqlDatabase; userId: string; bucket: AttachmentBucket }, target: RemoteTarget, snapshotId: string,
) {
  const snapshot = await readRemoteSnapshotMetadata(target, snapshotId);
  const extra = snapshot.accountExtras;
  return restoreSnapshot(ctx, target, snapshot, Boolean(extra),
    extra ? archiveExtraStatements(ctx.db, ctx.userId, extra.templates, extra.mapping, Date.now()) : []);
}

export async function restoreSnapshot(
  ctx: { db: SqlDatabase; userId: string; bucket: AttachmentBucket }, target: RemoteTarget | UploadedSnapshotSource,
  snapshot: Awaited<ReturnType<typeof readRemoteSnapshotMetadata>>, includeUnreferenced = false, extras: SqlStatement[] = [],
) {
  const referenced = includeUnreferenced ? snapshot.attachments : snapshot.attachments.filter((file) => file.referenced);
  const stagedKeys = await reserveAttachmentStage(ctx.db, ctx.userId, referenced.map((file) => file.sha256));
  for (const file of snapshot.attachments) {
    const bytes = await readVerifiedAttachment(target, snapshot.directory, file);
    const key = stagedKeys.get(file.sha256);
    if (key) await ctx.bucket.put(key, bytes);
  }
  const now = Date.now();
  const attachmentPublications: SqlStatement[] = [];
  const attachmentStatements: SqlStatement[] = [];
  for (const { sha256, size, mime } of referenced) {
    attachmentPublications.push(...publishAttachmentStatements(ctx.db, ctx.userId, sha256, size, mime, stagedKeys.get(sha256)!, now));
    attachmentStatements.push(...realignAttachmentStatements(ctx.db, ctx.userId, sha256, now));
  }
  const imported = await importBackupEntries(
    { db: ctx.db, userId: ctx.userId }, snapshot.entries, snapshot.itemKeyWraps, snapshot.topicKeyWraps, snapshot.settings, now,
    { attachmentPublications, attachmentStatements: [...attachmentStatements, ...extras], recoveryCodeBinding: snapshot.recoveryCodeBinding },
  );
  return { ...imported, attachments: referenced.length };
}
