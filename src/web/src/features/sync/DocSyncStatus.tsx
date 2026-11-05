import { useEffect, useState } from "react";
import { subscribeLocalChanges } from "../../lib/broadcast";
import { getSyncPhase, itemSyncStatus, requestSync, subscribeSyncStatus, type SyncPhase } from "../../services/syncEngine";

interface DocSyncStatusProps {
  userId: string;
  itemId: string;
  saving: boolean;
  dirty: boolean;
  saveError: boolean;
  onRetrySave?: () => void;
}

/** 文档栏里的保存与同步状态。失败给重试，不另开一处提示。 */
export function DocSyncStatus({ userId, itemId, saving, dirty, saveError, onRetrySave }: DocSyncStatusProps) {
  const [phase, setPhase] = useState<SyncPhase>(getSyncPhase);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => subscribeSyncStatus(() => setPhase(getSyncPhase())), []);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void itemSyncStatus(userId, itemId).then((status) => {
        if (cancelled) return;
        setPending(status.pending);
        setFailed(status.failed);
      });
    };
    load();
    return subscribeLocalChanges(() => { cancelled = false; load(); });
  }, [userId, itemId]);

  if (saving) return <span className="mn-savestate">保存中…</span>;
  if (saveError) return <button type="button" className="mn-savestate err" onClick={onRetrySave}>保存失败 · 重试</button>;
  if (dirty) return <span className="mn-savestate">尚未保存</span>;
  if (failed || phase === "error") {
    return <button type="button" className="mn-savestate err" onClick={() => void requestSync(userId)}>同步失败 · 重试</button>;
  }
  if (pending || phase === "syncing") return <span className="mn-savestate">{phase === "syncing" ? "同步中…" : "已保存 · 待同步"}</span>;
  return <span className="mn-savestate">已保存</span>;
}

