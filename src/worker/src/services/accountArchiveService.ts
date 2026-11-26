import { isClipTemplateV1, type AccountArchiveSummary } from "@menote/shared";
import type { RestoredMapping } from "../db/archiveExtras";
import { archiveExtraStatements } from "../db/archiveExtras";
import { readRemoteSnapshotMetadata, readVerifiedAttachment, type UploadedSnapshotSource } from "./backupVerifyService";
import { restoreSnapshot } from "./remoteRestoreService";

function parseMapping(value: unknown, tables: Set<string>): RestoredMapping | null {
  if (value == null) return null;
  const data = value as { bindings?: Array<Record<string, unknown>>; rows?: Array<Record<string, unknown>> };
  if (!Array.isArray(data.bindings) || !Array.isArray(data.rows) || data.bindings.length > 1) throw new Error("Raindrop 映射格式无效");
  if (!data.bindings.length && !data.rows.length) return null;
  const b = data.bindings[0];
  if (!b || typeof b.table_item_id !== "string" || !tables.has(b.table_item_id) || !Number.isSafeInteger(b.collection_id) ||
      ![1,6,24].includes(Number(b.pull_interval_hours))) throw new Error("Raindrop 映射与表格不符");
  const rows: RestoredMapping["rows"] = [];
  for (const row of data.rows) {
    if (typeof row.menote_row_id !== "string" || typeof row.raindrop_id !== "string" ||
      typeof row.baseline_json !== "string" || typeof row.baseline_hash !== "string" || typeof row.status !== "string" ||
      !["synced","dirty","conflict","orphaned","remote_missing"].includes(row.status) || typeof row.updated_at !== "number") throw new Error("Raindrop 行映射无效");
    JSON.parse(row.baseline_json);
    rows.push([row.menote_row_id,row.raindrop_id,row.baseline_json,row.baseline_hash,row.status,row.updated_at]);
  }
  return { tableId: b.table_item_id, collection: Number(b.collection_id), interval: Number(b.pull_interval_hours), rows };
}

export async function processAccountArchive(ctx: { db: D1Database; bucket: R2Bucket; userId: string }, source: UploadedSnapshotSource, restore: boolean): Promise<AccountArchiveSummary> {
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
  if (!source.clipTemplates.every(isClipTemplateV1)) throw new Error("迁移包的剪藏模板无效");
  const mapping = parseMapping(source.raindrop, tables);
  const summary = { items, topics, attachments: snapshot.attachments.length, templates: source.clipTemplates.length, raindropRows: mapping?.rows.length ?? 0, skipped: 0 };
  if (!restore) {
    for (const file of snapshot.attachments) await readVerifiedAttachment(source, snapshot.directory, file);
    return summary;
  }
  const extras = archiveExtraStatements(ctx.db, ctx.userId, source.clipTemplates, mapping, Date.now());
  const result = await restoreSnapshot(ctx, source, snapshot, true, extras);
  return { ...summary, items: result.items, topics: result.topics, skipped: result.skipped };
}
