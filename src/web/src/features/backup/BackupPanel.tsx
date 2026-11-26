import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, X } from "../../icons";
import { listTargets, type TargetView } from "../../services/backupService";
import { loadShared, peek, SETTINGS_CACHE } from "../../services/settingsPrefetch";
import { ArchiveRestorePanel } from "./ArchiveRestorePanel";
import { BackupTargetCard } from "./BackupTargetCard";
import { BackupTargetForm } from "./BackupTargetForm";
import "../../styles/backup.css";

export function BackupPanel({ userId }: { userId: string }) {
  const cacheKey = SETTINGS_CACHE.targets(userId);
  const [targets, setTargets] = useState(() => peek<TargetView[]>(cacheKey) ?? null);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState("");
  const request = useRef(0);
  const refresh = useCallback(async (fresh = true) => {
    const ticket = ++request.current;
    const result = await loadShared(cacheKey, listTargets, fresh);
    if (ticket === request.current) setTargets(result);
  }, [cacheKey]);
  useEffect(() => {
    void refresh(false);
    return () => { request.current++; };
  }, [refresh]);

  return <section className="status-panel mn-backup" aria-labelledby="backup-heading">
    <h2 id="backup-heading">备份与恢复</h2>
    <section className="bk-section" aria-labelledby="remote-backup-heading">
      <div className="bk-heading">
        <h3 id="remote-backup-heading">远端备份</h3>
        <button type="button" className="mn-textbtn bk-outline" aria-expanded={adding} aria-controls="bk-create"
          onClick={() => { setAdding(!adding); setMessage(""); }}>
          {adding ? <X /> : <Plus />}{adding ? "取消添加" : "添加备份位置"}
        </button>
      </div>
      <div id="bk-create" hidden={!adding}>
        {adding && <BackupTargetForm onCreated={async (text) => {
          await refresh(); setAdding(false); setMessage(text);
        }} />}
      </div>
      {message && <p role="status" className="bk-notice">{message}</p>}
      {targets === null && <p role="status" className="bk-meta">正在读取备份位置…</p>}
      {targets?.length === 0 && !adding && <p className="bk-empty">还没有远端备份。添加 WebDAV 或 S3 存储位置即可开始。</p>}
      {targets?.map(target => <BackupTargetCard key={target.id} userId={userId} target={target} refresh={refresh} />)}
    </section>
    <ArchiveRestorePanel userId={userId} />
  </section>;
}
