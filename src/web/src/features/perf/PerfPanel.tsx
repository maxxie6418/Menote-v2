import { useEffect, useState } from "react";
import { perfProbe, setPerfEnabled, type ProbeSummary } from "../../lib/perfProbe";
import { buildBaselineFixture } from "./fixtures";

/**
 * 性能诊断面板（FR-EDT-10 / TP4 · W0）。
 *
 * 只在诊断模式（`?perf=1` 或本地存储开关）下挂载；关闭时应用里不存在这个组件，
 * 探针也不注册任何观察器（见 lib/perfProbe）。
 */
export function PerfPanel() {
  const [rows, setRows] = useState<ProbeSummary[]>([]);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => setRows(perfProbe.summary()), 500);
    return () => window.clearInterval(timer);
  }, []);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 1500);
    } catch {
      setCopied("复制失败");
    }
  };

  return (
    <div className="mn-perfpanel" role="region" aria-label="性能诊断">
      <div className="mn-perfpanel-head">
        <span>性能诊断</span>
        <button type="button" className="mn-perfbtn" onClick={() => setRows(perfProbe.summary())}>刷新</button>
        <button type="button" className="mn-perfbtn" onClick={() => { perfProbe.reset(); setRows([]); }}>重置</button>
        <button type="button" className="mn-perfbtn" onClick={() => { perfProbe.disable(); setPerfEnabled(false); location.reload(); }}>关闭</button>
      </div>
      <table className="mn-perftable">
        <thead>
          <tr><th>指标</th><th>次数</th><th>平均</th><th>P95</th><th>最长</th></tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={5}>暂无采样。打开一篇笔记并输入即可采集。</td></tr>
          ) : rows.map((row) => (
            <tr key={row.name}>
              <td>{row.name}</td>
              <td>{row.count}</td>
              <td>{row.avg.toFixed(1)}</td>
              <td>{row.p95.toFixed(1)}</td>
              <td>{row.max.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mn-perfpanel-actions">
        <button type="button" className="mn-perfbtn" onClick={() => { void copy(perfProbe.exportJson(), "已复制 JSON"); }}>
          复制 JSON{copied === "已复制 JSON" ? " ✓" : ""}
        </button>
        <button type="button" className="mn-perfbtn" onClick={() => { void copy(buildBaselineFixture(), "已复制基线语料"); }}>
          复制基线语料{copied === "已复制基线语料" ? " ✓" : ""}
        </button>
      </div>
    </div>
  );
}
