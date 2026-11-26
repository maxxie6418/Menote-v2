import type { AccountArchiveSummary } from "@menote/shared";
import { parseAccountExtras } from "./backupExtras";
import { archiveExtraStatements } from "../db/archiveExtras";
import { readRemoteSnapshotMetadata, readVerifiedAttachment, type UploadedSnapshotSource } from "./backupVerifyService";
import { restoreSnapshot } from "./remoteRestoreService";

export async function processAccountArchive(ctx: { db: SqlDatabase; bucket: AttachmentBucket; userId: string }, source: UploadedSnapshotSource, restore: boolean): Promise<AccountArchiveSummary> {
  const snapshot = await readRemoteSnapshotMetadata(source, source.id);
  const tables = new Set<string>();
  let items = 0, topics = 0;
  for (const raw of snapshot.entries) {
    const row = raw as {kind?: string; data?: {id?: string; type?: string}};
    if (!row?.data?.id) throw new Error("快照条目缺少 ID");
    if (row.kind === "item") { items++; if (row.data.type === "table") tables.add(row.data.id); }
    else if (row.kind === "topic") topics++;
    else if (row.kind !== "memo_comment") throw new Error("快照包含未知条目类型");
  }
  const { templates, mapping } = snapshot.accountExtras ?? parseAccountExtras(source, tables);
  const summary = { items, topics, attachments: snapshot.attachments.length, templates: templates.length, raindropRows: mapping?.rows.length ?? 0, skipped: 0 };
  if (!restore) {
    for (const file of snapshot.attachments) await readVerifiedAttachment(source, snapshot.directory, file);
    return summary;
  }
  const extras = archiveExtraStatements(ctx.db, ctx.userId, templates, mapping, Date.now());
  const result = await restoreSnapshot(ctx, source, snapshot, true, extras);
  return { ...summary, items: result.items, topics: result.topics, skipped: result.skipped };
}
