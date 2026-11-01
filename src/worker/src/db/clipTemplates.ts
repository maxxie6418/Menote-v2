import type { ClipTemplateV1 } from "@menote/shared";

interface TemplateRow { template_json: string; version: number; created_at: number; updated_at: number }

export async function listClipTemplates(db: D1Database, userId: string, enabledOnly = false) {
  const rows = await db.prepare(`SELECT template_json, version, created_at, updated_at FROM clip_templates WHERE user_id = ?${enabledOnly ? " AND json_extract(template_json, '$.enabled') = 1" : ""} ORDER BY updated_at DESC`)
    .bind(userId).all<TemplateRow>();
  return rows.results.flatMap((row) => {
    try { return [{ template: JSON.parse(row.template_json) as ClipTemplateV1, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at }]; }
    catch { return []; }
  });
}

export async function saveClipTemplate(db: D1Database, userId: string, template: ClipTemplateV1, now: number, expectedVersion?: number | null): Promise<boolean> {
  const payload = JSON.stringify(template);
  if (expectedVersion === null) {
    const result = await db.prepare(`INSERT OR IGNORE INTO clip_templates (id, user_id, template_json, version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)`)
      .bind(template.id, userId, payload, now, now).run();
    return (result.meta.changes ?? 0) === 1;
  }
  if (typeof expectedVersion === "number") {
    const result = await db.prepare(`UPDATE clip_templates SET template_json = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND id = ? AND version = ?`)
      .bind(payload, now, userId, template.id, expectedVersion).run();
    return (result.meta.changes ?? 0) === 1;
  }
  await db.prepare(`INSERT INTO clip_templates (id, user_id, template_json, version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)
    ON CONFLICT(user_id, id) DO UPDATE SET template_json = excluded.template_json, version = clip_templates.version + 1, updated_at = excluded.updated_at`)
    .bind(template.id, userId, payload, now, now).run();
  return true;
}

export async function deleteClipTemplate(db: D1Database, userId: string, id: string) {
  const result = await db.prepare("DELETE FROM clip_templates WHERE user_id = ? AND id = ?").bind(userId, id).run();
  return (result.meta.changes ?? 0) > 0;
}
