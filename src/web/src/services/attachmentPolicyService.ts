import type { UserSetting } from "@menote/shared";
import { localDb } from "../db/localDb";
import { enqueueOutbox } from "../db/outboxRepo";
import { newId } from "../lib/hash";

export interface AttachmentPolicy { maxBytes: number; allowedExtensions: string[] }
export const DEFAULT_ATTACHMENT_POLICY: AttachmentPolicy = {
  maxBytes: 20 * 1024 * 1024,
  allowedExtensions: ["png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "md"],
};
const SETTING_KEY = "attachmentPolicy";

function normalize(value: unknown): AttachmentPolicy {
  const raw = typeof value === "object" && value !== null ? value as Partial<AttachmentPolicy> : {};
  return {
    maxBytes: typeof raw.maxBytes === "number" && Number.isFinite(raw.maxBytes) ? Math.max(1, Math.min(DEFAULT_ATTACHMENT_POLICY.maxBytes, Math.floor(raw.maxBytes))) : DEFAULT_ATTACHMENT_POLICY.maxBytes,
    allowedExtensions: Array.isArray(raw.allowedExtensions)
      ? [...new Set(raw.allowedExtensions.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.toLowerCase().replace(/^\./, "").trim()).filter((entry) => /^[a-z0-9]{1,12}$/.test(entry)))].slice(0, 64)
      : [...DEFAULT_ATTACHMENT_POLICY.allowedExtensions],
  };
}

export async function readAttachmentPolicy(userId: string): Promise<AttachmentPolicy> {
  const row = await localDb.settings.get([userId, SETTING_KEY]);
  return row?.sensitivity === "ordinary" ? normalize(row.value) : { ...DEFAULT_ATTACHMENT_POLICY, allowedExtensions: [...DEFAULT_ATTACHMENT_POLICY.allowedExtensions] };
}

export async function updateAttachmentPolicy(userId: string, value: AttachmentPolicy): Promise<AttachmentPolicy> {
  const next = normalize(value);
  await localDb.transaction("rw", localDb.settings, localDb.outbox, async () => {
    const current = await localDb.settings.get([userId, SETTING_KEY]);
    const queued = (await localDb.outbox.where("userId").equals(userId).toArray())
      .filter((row) => row.entity === "setting" && row.entityId === SETTING_KEY).sort((a, b) => a.seq! - b.seq!);
    const baseRev = queued[0]?.baseRev ?? current?.rev ?? 0;
    const setting: UserSetting = { userId, key: SETTING_KEY, sensitivity: "ordinary", value: next, rev: baseRev + 1, updatedAt: Date.now() };
    await localDb.settings.put(setting);
    if (queued.length) await localDb.outbox.bulkDelete(queued.map((row) => row.seq!));
    await enqueueOutbox([{ operationId: newId(), userId, entityId: SETTING_KEY, entity: "setting", action: "upsert", baseRev, baseMetaRev: 0, payload: { setting }, queuedAt: Date.now(), retries: 0, nextRetryAt: null, lastError: null }]);
  });
  window.dispatchEvent(new Event("menote:attachment-policy"));
  void import("./syncEngine").then(({ requestSync }) => requestSync(userId));
  return next;
}

export async function applyPulledAttachmentPolicy(userId: string, settings: UserSetting[]): Promise<void> {
  const remote = settings.find((row) => row.key === SETTING_KEY && row.sensitivity === "ordinary");
  if (!remote || remote.sensitivity !== "ordinary") return;
  const pending = await localDb.outbox.where("userId").equals(userId).and((row) => row.entity === "setting" && row.entityId === SETTING_KEY).count();
  if (pending > 0) return;
  await localDb.settings.put({ ...remote, value: normalize(remote.value) });
  window.dispatchEvent(new Event("menote:attachment-policy"));
}
