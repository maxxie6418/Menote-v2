/** 本地变更广播：跨标签页刷新信号（G2 §8；不带任何内容，仅触发各页重读本地库）。
 *  仅浏览器环境启用（跨标签页是浏览器语义）；Node/测试环境为空实现，避免挂住事件循环。 */
type LocalChangeEvent = "content-changed";

let channel: BroadcastChannel | null = null;
const listeners = new Set<() => void>();

function ensureChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!channel) {
    channel = new BroadcastChannel("menote-local");
    channel.onmessage = () => listeners.forEach((listener) => listener());
  }
  return channel;
}

/** 命令层事务提交后调用；同标签页经 Dexie liveQuery 自动更新，无需广播。 */
export function notifyLocalChange(): void {
  ensureChannel()?.postMessage(1);
}

export function subscribeLocalChanges(listener: () => void): () => void {
  ensureChannel();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export type { LocalChangeEvent };
