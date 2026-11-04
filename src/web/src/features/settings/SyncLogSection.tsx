import { useCallback, useEffect, useMemo, useState } from "react";
import { clearSyncDiagnostics, listSyncDiagnostics, subscribeSyncDiagnostics, type SyncDiagnosticRow } from "../../services/syncDiagnosticsService";

type CategoryFilter = "all" | SyncDiagnosticRow["category"];

const CATEGORY_LABEL: Record<SyncDiagnosticRow["category"], string> = {
  local: "本地保存", cycle: "同步轮次", push: "上传", pull: "拉取", conflict: "冲突", error: "错误",
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export function SyncLogSection({ userId }: { userId: string }) {
  const [rows, setRows] = useState<SyncDiagnosticRow[]>([]);
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(() => {
    void listSyncDiagnostics(userId).then(setRows);
  }, [userId]);

  useEffect(() => {
    refresh();
    return subscribeSyncDiagnostics(refresh);
  }, [refresh]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return rows.filter((row) => (filter === "all" || row.category === filter)
      && (!needle || JSON.stringify(row).toLocaleLowerCase().includes(needle)));
  }, [filter, query, rows]);

  const serialized = () => JSON.stringify({
    exportedAt: new Date().toISOString(),
    privacy: "Contains sync metadata only; note content, titles, attachment names and keys are excluded.",
    entries: filtered,
  }, null, 2);

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(serialized());
      setNotice(`已复制 ${filtered.length} 条日志`);
    } catch {
      setNotice("复制失败，请使用导出文件");
    }
  };

  const exportLogs = () => {
    const blob = new Blob([serialized()], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `menote-sync-diagnostics-${new Date().toISOString().replaceAll(":", "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice(`已导出 ${filtered.length} 条日志`);
  };

  const clearLogs = async () => {
    if (!window.confirm("清除本账号在此浏览器保存的同步诊断日志？")) return;
    await clearSyncDiagnostics(userId);
    setNotice("诊断日志已清除");
  };

  return (
    <section className="mn-sync-log" aria-label="同步诊断日志">
      <div className="mn-setrow">
        <div><div className="mn-setlabel">同步诊断日志</div><p className="mn-sethint">日志保存在此浏览器本机，最多保留 2,000 条。仅记录同步操作、版本号和回执，不记录笔记正文、标题或密钥。</p></div>
      </div>
      <div className="mn-sync-log-tools">
        <label>类型
          <select className="app-select" value={filter} onChange={(event) => setFilter(event.target.value as CategoryFilter)}>
            <option value="all">全部</option>
            {Object.entries(CATEGORY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="mn-sync-log-search">查询
          <input className="app-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="笔记 ID、操作 ID、错误码" />
        </label>
        <span className="mn-sync-log-count">{filtered.length} / {rows.length}</span>
      </div>
      <div className="mn-sync-log-actions">
        <button type="button" className="app-button" onClick={() => void copyLogs()} disabled={!filtered.length}>复制筛选结果</button>
        <button type="button" className="app-button" onClick={exportLogs} disabled={!filtered.length}>导出 JSON</button>
        <button type="button" className="app-button" onClick={() => void clearLogs()} disabled={!rows.length}>清除日志</button>
        {notice && <span role="status" className="mn-sethint">{notice}</span>}
      </div>
      <div className="mn-sync-log-list">
        {filtered.length === 0
          ? <p className="mn-sethint">{rows.length ? "没有匹配的日志" : "还没有同步日志。新建或保存笔记后，这里会记录本地保存、上传和云端回执。"}</p>
          : filtered.map((row) => (
            <details className="mn-sync-log-entry" key={row.id}>
              <summary>
                <time>{formatTime(row.at)}</time>
                <strong className={`is-${row.category}`}>{CATEGORY_LABEL[row.category]}</strong>
                <span>{row.event}</span>
                {row.entityId && <code>{row.entityId}</code>}
                {row.result && <em>{row.result}</em>}
              </summary>
              <pre>{JSON.stringify(row, null, 2)}</pre>
            </details>
          ))}
      </div>
    </section>
  );
}
