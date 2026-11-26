import { isClipTemplateV1 } from "@menote/shared";
import type { RestoredMapping } from "../db/archiveExtras";

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

export function parseAccountExtras(value: unknown, tables: Set<string>) {
  const extras = value as { clipTemplates?: unknown; raindrop?: unknown } | null;
  if (!Array.isArray(extras?.clipTemplates) || !extras.clipTemplates.every(isClipTemplateV1)) throw new Error("快照的剪藏模板无效");
  return { templates: extras.clipTemplates, mapping: parseMapping(extras.raindrop, tables) };
}
