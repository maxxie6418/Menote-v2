import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { getSyncPhase, getSyncProgress, requestSyncNow, subscribeSyncStatus, syncQueueStatus, type SyncPhase, type SyncProgress } from "../../services/syncEngine";
import { subscribeLocalChanges } from "../../lib/broadcast";

export function SidebarSyncControl({ userId, collapsed }: { userId: string; collapsed: boolean }) {
  const [phase, setPhase] = useState<SyncPhase>(getSyncPhase);
  const [progress, setProgress] = useState<SyncProgress>(getSyncProgress);
  const [queue, setQueue] = useState({ pending: 0, failed: 0 });
  const [online, setOnline] = useState(() => navigator.onLine);
  const [manualBusy, setManualBusy] = useState(false);
  useEffect(() => subscribeSyncStatus(() => { setPhase(getSyncPhase()); setProgress(getSyncProgress()); }), []);
  useEffect(() => {
    const refresh = () => { void syncQueueStatus(userId).then(setQueue); };
    refresh();
    return subscribeLocalChanges(refresh);
  }, [userId]);
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, []);
  const label = phase === "syncing" ? "同步中" : phase === "error" ? "同步异常" : !online ? "离线，等待联网" : queue.failed ? `同步异常 · ${queue.failed} 项失败` : queue.pending ? `${queue.pending} 项待上传` : "已同步";
  return <div className="mn-sidebar-sync">
    <button type="button" className="mn-sidebar-sync-button" disabled={manualBusy || !online}
      aria-label={phase === "syncing" ? "当前同步结束后立即再同步" : "立即同步"} title={phase === "syncing" ? "当前同步结束后立即再同步" : "立即同步"}
      onClick={() => { setManualBusy(true); void requestSyncNow(userId).finally(() => setManualBusy(false)); }}>
      <RefreshCw aria-hidden="true" />{!collapsed && <span>立即同步</span>}
    </button>
    {!collapsed && <span className="mn-sidebar-sync-state" role="status">{label}</span>}
    {phase === "syncing" && !collapsed && <progress className="mn-sidebar-sync-progress"
      value={progress.stage === "push" && progress.total > 0 ? progress.completed : undefined}
      max={progress.stage === "push" && progress.total > 0 ? progress.total : undefined}
      aria-label={progress.stage === "pull" ? "正在拉取更新" : "正在推送变更"} />}
  </div>;
}
