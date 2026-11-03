import { listAttachments, listAttachmentReferences } from "./attachmentService";
import { readAiUsage } from "./aiService";
import { readAiSettings } from "./aiSettingsService";
import { listTargets } from "./backupService";
import { listClipTemplates } from "./clipTemplateService";
import { listMcpScopeTopics, listMcpTokens } from "./mcpTokenService";
import { readRaindropStatus } from "./raindropService";
import { readRaindropSettings } from "./raindropSettingsService";

/**
 * 设置常用数据的会话缓存。主界面打开时预取，设置弹层先用已有结果，再静默刷新。
 * 只缓存列表和开关，不预取 Token 明文或备份凭据。
 */

const memory = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();
const generation = new Map<string, number>();

export const SETTINGS_CACHE = {
  targets: "backup.targets",
  tokens: "mcp.tokens",
  topics: "mcp.topics",
  ai: (userId: string) => `ai.settings:${userId}`,
  usage: "ai.usage",
  raindrop: (userId: string) => `raindrop.settings:${userId}`,
  raindropStatus: "raindrop.status",
  attachments: (userId: string) => `attachments:${userId}`,
  attachmentRefs: (userId: string) => `attachment.refs:${userId}`,
  clipTemplates: "clip.templates",
} as const;

/** 已取到的结果。键不存在返回 undefined；存过 null 的键返回 null。 */
export function peek<T>(key: string): T | undefined {
  return memory.has(key) ? memory.get(key) as T : undefined;
}

/** 同一键的在途请求合并。fresh 为 true 时另起一次，旧结果不再覆盖新结果。 */
export function loadShared<T>(key: string, load: () => Promise<T>, fresh = false): Promise<T> {
  if (!fresh) {
    const pending = inflight.get(key);
    if (pending) return pending as Promise<T>;
  }
  const ticket = (generation.get(key) ?? 0) + 1;
  generation.set(key, ticket);
  const task = load().then((value) => {
    if (generation.get(key) === ticket) memory.set(key, value);
    if (inflight.get(key) === task) inflight.delete(key);
    return value;
  }, (error: unknown) => {
    if (inflight.get(key) === task) inflight.delete(key);
    throw error;
  });
  inflight.set(key, task);
  return task;
}

/** 登录进主界面后调用。失败留空，打开设置时再取。 */
export function prefetchSettings(userId: string): void {
  void loadShared(SETTINGS_CACHE.targets, listTargets).catch(() => undefined);
  void loadShared(SETTINGS_CACHE.tokens, listMcpTokens).catch(() => undefined);
  void loadShared(SETTINGS_CACHE.topics, listMcpScopeTopics).catch(() => undefined);
  void loadShared(SETTINGS_CACHE.ai(userId), () => readAiSettings(userId)).catch(() => undefined);
  void loadShared(SETTINGS_CACHE.usage, () => readAiUsage()).catch(() => undefined);
  void loadShared(SETTINGS_CACHE.raindrop(userId), () => readRaindropSettings(userId)).catch(() => undefined);
  void loadShared(SETTINGS_CACHE.raindropStatus, () => readRaindropStatus()).catch(() => undefined);
  void loadShared(SETTINGS_CACHE.attachments(userId), () => listAttachments(userId)).catch(() => undefined);
  void loadShared(SETTINGS_CACHE.attachmentRefs(userId), () => listAttachmentReferences(userId)).catch(() => undefined);
  void loadShared(SETTINGS_CACHE.clipTemplates, listClipTemplates).catch(() => undefined);
}
