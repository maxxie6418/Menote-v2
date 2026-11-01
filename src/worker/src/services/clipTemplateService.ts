import { isClipTemplateV1, type ClipTemplateV1 } from "@menote/shared";
import { deleteClipTemplate, listClipTemplates, saveClipTemplate } from "../db/clipTemplates";

export { deleteClipTemplate, listClipTemplates };
export async function persistClipTemplate(db: D1Database, userId: string, value: unknown, now = Date.now(), expectedVersion?: number | null): Promise<ClipTemplateV1 | null | "version_conflict"> {
  if (!isClipTemplateV1(value)) return null;
  if (!(await saveClipTemplate(db, userId, value, now, expectedVersion))) return "version_conflict";
  return value;
}
