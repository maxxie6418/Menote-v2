/**
 * 设置常用数据的会话缓存。按设置分区读取，设置弹层先用已有结果，再静默刷新。
 * 只缓存列表和开关，不预取 Token 明文或备份凭据。
 */

const memory = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();
const generation = new Map<string, number>();

export const SETTINGS_CACHE = {
  targets: (userId: string) => `backup.targets:${userId}`,
  tokens: (userId: string) => `mcp.tokens:${userId}`,
  topics: (userId: string) => `mcp.topics:${userId}`,
  ai: (userId: string) => `ai.settings:${userId}`,
  usage: "ai.usage",
  raindrop: (userId: string) => `raindrop.settings:${userId}`,
  raindropStatus: "raindrop.status",
  attachments: (userId: string, cursor = "") => `attachments:${userId}:${cursor}`,
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
