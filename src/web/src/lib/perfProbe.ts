/**
 * 性能诊断探针（FR-EDT-10 / TP4 · W0）。
 *
 * 设计约束：**默认关闭，零常驻开销**。
 * - 关闭时不注册任何 PerformanceObserver、不打点、不产生字符串拼接；
 * - 只有诊断开关打开（URL 参数 `?perf=1` 或本地存储 `menote:perf=1`）才启用。
 * - 聚合只保留数字，不保留逐条样本，避免长时间运行后内存增长。
 *
 * 用途：为 TP4.5 的增量与渐进渲染建立可对比的基线（开放项 #14）。
 */

/** 单个指标桶的汇总结果。 */
export interface ProbeSummary {
  name: string;
  /** 采样次数。 */
  count: number;
  /** 累计耗时（毫秒）。 */
  total: number;
  /** 平均耗时（毫秒）。 */
  avg: number;
  /** P95 耗时（毫秒）。 */
  p95: number;
  /** 最长耗时（毫秒）。 */
  max: number;
}

const PARAM_KEY = "perf";
const STORAGE_KEY = "menote:perf";

/** 取高精度计时；无 performance 时退回 Date.now（精度不足但不会崩）。 */
function now(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now();
  return Date.now();
}

/** 是否请求了诊断模式。URL 参数优先，其次本地存储。 */
export function isPerfRequested(): boolean {
  try {
    if (typeof location !== "undefined" && new URLSearchParams(location.search).get(PARAM_KEY) === "1") return true;
  } catch {
    // 某些环境没有 location 或 URLSearchParams，忽略
  }
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "1") return true;
  } catch {
    // 隐私模式下 localStorage 可能抛错，忽略
  }
  return false;
}

/** 打开/关闭本地存储里的诊断开关（设置页或控制台可用）。 */
export function setPerfEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (enabled) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略存储失败
  }
}

export class PerfProbe {
  private enabled = false;
  private readonly buckets = new Map<string, number[]>();
  private observer: PerformanceObserver | null = null;

  /** 当前是否处于诊断模式。 */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /** 开启诊断：注册长任务观察（浏览器不支持时静默降级）。 */
  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    if (typeof PerformanceObserver === "undefined") return;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) this.record("longtask", entry.duration);
      });
      observer.observe({ type: "longtask", buffered: false });
      this.observer = observer;
    } catch {
      // 浏览器不支持 longtask 类型时忽略
      this.observer = null;
    }
  }

  /** 关闭诊断并断开观察器。已采集的数据保留，直到 reset。 */
  disable(): void {
    this.enabled = false;
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  /** 记录一次耗时（毫秒）。关闭时不做任何事。 */
  record(name: string, duration: number): void {
    if (!this.enabled) return;
    const bucket = this.buckets.get(name);
    if (bucket) bucket.push(duration);
    else this.buckets.set(name, [duration]);
  }

  /** 包裹一段同步工作并计时。关闭时直接执行，不产生额外开销。 */
  measure<T>(name: string, fn: () => T): T {
    if (!this.enabled) return fn();
    const start = now();
    try {
      return fn();
    } finally {
      this.record(name, now() - start);
    }
  }

  /** 汇总全部指标，按名称排序。 */
  summary(): ProbeSummary[] {
    const result: ProbeSummary[] = [];
    for (const [name, samples] of this.buckets) {
      if (samples.length === 0) continue;
      const sorted = [...samples].sort((a, b) => a - b);
      const total = sorted.reduce((sum, value) => sum + value, 0);
      const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
      result.push({
        name,
        count: sorted.length,
        total,
        avg: total / sorted.length,
        p95: sorted[index]!,
        max: sorted[sorted.length - 1]!,
      });
    }
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
  }

  /** 清空已采集数据。 */
  reset(): void {
    this.buckets.clear();
  }

  /** 导出为 JSON 文本，便于粘贴进开发记录。 */
  exportJson(): string {
    return JSON.stringify({ at: new Date().toISOString(), buckets: this.summary() }, null, 2);
  }
}

/** 全局单例：整个应用共用一个探针。 */
export const perfProbe = new PerfProbe();

/** 诊断模式下自动开启。生产路径不注册任何观察器。 */
if (isPerfRequested()) perfProbe.enable();
