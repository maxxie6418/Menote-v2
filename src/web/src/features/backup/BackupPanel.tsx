import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Archive, Plus, X } from "../../icons";
import { getBackupRun, listTargets, runBackups, subscribeBackupRuns, type TargetView } from "../../services/backupService";
import { loadShared, peek, SETTINGS_CACHE } from "../../services/settingsPrefetch";
import { ArchiveRestorePanel } from "./ArchiveRestorePanel";
import { BackupTargetCard } from "./BackupTargetCard";
import { BackupTargetForm } from "./BackupTargetForm";

export function BackupPanel({ userId, active }: { userId: string; active: boolean }) {
  const cacheKey = SETTINGS_CACHE.targets(userId);
  const [targets, setTargets] = useState(() => peek<TargetView[]>(cacheKey) ?? null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState(false);
  const run = useSyncExternalStore(subscribeBackupRuns, () => getBackupRun(userId));
  const request = useRef(0);
  const observedRun = useRef(run.running);
  const refresh = useCallback(async (fresh = true) => {
    const ticket = ++request.current;
    setLoadError(false);
    try {
      const result = await loadShared(cacheKey, listTargets, fresh);
      if (ticket === request.current) setTargets(result);
    } catch {
      if (ticket === request.current) setLoadError(true);
    }
  }, [cacheKey]);

  useEffect(() => {
    void refresh(false);
    return () => { request.current++; };
  }, [refresh]);
  useEffect(() => {
    if (observedRun.current && !run.running) void refresh();
    observedRun.current = run.running;
  }, [run.running, refresh]);

  const enabled = targets?.filter((target) => target.enabled) ?? [];
  const lastPushedAt = targets?.reduce((latest, target) => Math.max(latest, target.lastPushedAt ?? 0), 0) ?? 0;
  const backupStatus = targets === null
    ? loadError ? "无法读取备份位置" : "正在读取备份位置…"
    : enabled.length ? enabled.length + " 个远端备份位置已启用" : "暂无已启用的远端备份位置";

  return <div className="mn-backup">
    <section className="mn-settings-card mn-settings-status" aria-label="远端备份状态">
      <div className="mn-settings-heading">
        <div className="mn-backup-summary">
          <span className="bk-icon" aria-hidden="true"><Archive /></span>
          <div>
            <h3>{backupStatus}</h3>
            <p className="mn-sethint">{lastPushedAt ? "最近成功于 " + new Date(lastPushedAt).toLocaleString("zh-CN", { hour12: false }) : "开启远端位置后可手动或定时备份。"}</p>
          </div>
        </div>
        <button type="button" className="mn-textbtn mn-settings-primary" disabled={enabled.length === 0 || run.running || loadError}
          onClick={() => void runBackups(userId, enabled, true)}>立即备份</button>
      </div>
      {run.status && <p role="status" className="bk-notice">{run.status}</p>}
      {run.results.length > 0 && <ul className="mn-backup-results" aria-live="polite">
        {run.results.map(result => <li key={result.id}><strong>{result.name}</strong><span data-error={!result.ok}>{result.ok ? "" : "失败 · "}{result.detail}</span></li>)}
      </ul>}
    </section>
    <section className="bk-section" aria-labelledby="remote-backup-heading">
      <div className="bk-heading">
        <h3 id="remote-backup-heading">远端备份位置</h3>
        <button type="button" className="mn-textbtn bk-outline" aria-expanded={adding} aria-controls="bk-create"
          disabled={run.running} onClick={() => { setAdding(!adding); setMessage(""); }}>
          {adding ? <X /> : <Plus />}{adding ? "取消添加" : "添加备份位置"}
        </button>
      </div>
      <div id="bk-create" hidden={!adding}>
        {adding && <BackupTargetForm active={active} onCreated={async (status) => {
          await refresh();
          setAdding(false);
          setMessage(status);
        }} />}
      </div>
      {message && <p role="status" className="bk-notice">{message}</p>}
      {loadError && <div className="mn-settings-heading mn-settings-notice is-error" role="status">
        <p>无法读取最新备份位置，请检查连接。</p>
        <button type="button" className="mn-textbtn mn-settings-outline" onClick={() => void refresh()}>重试</button>
      </div>}
      {targets === null && !loadError && <p role="status" className="bk-meta">正在读取备份位置…</p>}
      {targets?.length === 0 && !adding && !loadError && <div className="mn-backup-empty">
        <Archive aria-hidden="true" />
        <strong>还没有远端备份位置</strong>
        <p className="bk-meta">可以添加 WebDAV 或 S3。每个位置可单独设置备份频率和保留数量。</p>
        <button type="button" className="mn-textbtn bk-outline" onClick={() => { setAdding(true); setMessage(""); }}>添加第一个位置</button>
      </div>}
      {active && targets?.map(target => <BackupTargetCard key={target.id} userId={userId} target={target} refresh={refresh}
        pushing={run.running} revision={run.results.find(result => result.id === target.id)?.finishedAt ?? 0}
        pushTarget={() => runBackups(userId, [target], false)} />)}
    </section>
    {active && <ArchiveRestorePanel userId={userId} />}
  </div>;
}
