import { isClipTemplateV1, type ClipTemplateV1 } from "@menote/shared";
import { deleteClipTemplate, listClipTemplates, saveClipTemplate } from "../db/clipTemplates";

export { deleteClipTemplate, listClipTemplates };
export async function persistClipTemplate(db: D1Database, userId: string, value: unknown, now = Date.now(), expectedVersion?: number | null): Promise<ClipTemplateV1 | null | "version_conflict"> {
  if (!isClipTemplateV1(value)) return null;
  if (!(await saveClipTemplate(db, userId, value, now, expectedVersion))) return "version_conflict";
  return value;
}

export interface AdapterRegistration {
  id: string;
  name: string;
  version: string;
  hosts: string[];
  upstream?: string;
}

/**
 * 幂等登记命令式适配器元数据：实现随扩展发行，这里只维护应用侧注册表（元数据 + 启停开关）。
 * 仅在版本/名称/匹配站点变化时写库（避免每次同步都抬 version）；下线的适配器条目予以清理。
 */
export async function registerCaptureAdapters(
  db: D1Database, userId: string, registrations: AdapterRegistration[], now = Date.now(),
): Promise<{ registered: number; pruned: number }> {
  const existing = await listClipTemplates(db, userId);
  const wantedIds = new Set<string>();
  let registered = 0;
  for (const registration of registrations) {
    const id = `adapter:${registration.id}`.slice(0, 80);
    wantedIds.add(id);
    const prior = existing.find((entry) => entry.template.id === id);
    const priorAdapter = prior?.template.pipeline === "capture-clip" ? prior.template.adapter : undefined;
    const unchanged = prior && priorAdapter
      && priorAdapter.id === registration.id && priorAdapter.version === registration.version
      && (priorAdapter.upstream ?? "") === (registration.upstream ?? "")
      && prior.template.name === registration.name
      && JSON.stringify(prior.template.match.hosts) === JSON.stringify(registration.hosts);
    if (unchanged) continue;
    const template: ClipTemplateV1 = {
      schemaVersion: 1,
      id,
      name: registration.name,
      enabled: prior?.template.enabled ?? true,
      pipeline: "capture-clip",
      match: { hosts: registration.hosts, paths: [] },
      exclude: [],
      adapter: {
        id: registration.id,
        version: registration.version,
        ...(registration.upstream ? { upstream: registration.upstream } : {}),
      },
      source: registration.upstream
        ? { kind: "edgeever", repository: "tianma-if/edgeever", commit: registration.upstream }
        : { kind: "manual" },
    };
    if (!isClipTemplateV1(template)) continue;
    await saveClipTemplate(db, userId, template, now, prior?.version);
    registered += 1;
  }
  let pruned = 0;
  for (const entry of existing) {
    if (entry.template.pipeline !== "capture-clip" || wantedIds.has(entry.template.id)) continue;
    await deleteClipTemplate(db, userId, entry.template.id);
    pruned += 1;
  }
  return { registered, pruned };
}
