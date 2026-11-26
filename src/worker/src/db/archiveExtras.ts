import type { ClipTemplateV1 } from "@menote/shared";

export interface RestoredMapping {
  tableId: string;
  collection: number;
  interval: number;
  rows: [string, string, string, string, string, number][];
}

export function archiveExtraStatements(db: SqlDatabase, userId: string, templates: ClipTemplateV1[], mapping: RestoredMapping | null, now: number) {
  const statements = templates.map(template => db.prepare(
    "INSERT INTO clip_templates (id,user_id,template_json,version,created_at,updated_at) VALUES (?,?,?,1,?,?) ON CONFLICT(user_id,id) DO NOTHING",
  ).bind(template.id, userId, JSON.stringify(template), now, now));
  if (!mapping) return statements;
  const { tableId, collection, interval, rows } = mapping;
  statements.push(db.prepare(
    "INSERT INTO raindrop_bindings (user_id,table_item_id,collection_id,pull_interval_hours,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id) DO NOTHING",
  ).bind(userId, tableId, collection, interval, now, now));
  // A previously configured account must never acquire rows for a different table.
  for (let start = 0; start < rows.length; start += 100) {
    statements.push(db.prepare(`INSERT INTO raindrop_sync_rows
        (user_id,menote_row_id,raindrop_id,baseline_json,baseline_hash,status,updated_at)
      SELECT ?,json_extract(value,'$[0]'),json_extract(value,'$[1]'),json_extract(value,'$[2]'),
        json_extract(value,'$[3]'),json_extract(value,'$[4]'),json_extract(value,'$[5]') FROM json_each(?)
      WHERE EXISTS (SELECT 1 FROM raindrop_bindings WHERE user_id=? AND table_item_id=? AND collection_id=?)
      ON CONFLICT(user_id,menote_row_id) DO NOTHING`)
      .bind(userId, JSON.stringify(rows.slice(start, start + 100)), userId, tableId, collection));
  }
  return statements;
}
