import { useCallback, useEffect, useState } from "react";
import {
  type TargetView, createTarget, deleteTarget, listTargets, revealSecret, runTargetOnce, updateTarget,
} from "../../services/backupService";

interface BackupPanelProps { userId: string }

/** 备份目标管理（G9，FR-BAK-1/2/8）：目标 CRUD、凭据复显（C-7）、手动推送一次、运行状态。 */
export function BackupPanel({ userId }: BackupPanelProps) {
  void userId;
  const [targets, setTargets] = useState<TargetView[] | null>(null);
  const [kind, setKind] = useState<"webdav" | "s3">("webdav");
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [bucket, setBucket] = useState("");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [schedule, setSchedule] = useState<"manual" | "daily" | "weekly">("manual");
  const [message, setMessage] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const refresh = useCallback(() => {
    listTargets().then(setTargets);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const create = async () => {
    setMessage(null);
    const ok = await createTarget({ kind, endpoint, bucket: bucket || null, username: username || null, secret, schedule, name: name || undefined });
    if (ok) {
      setSecret(""); setEndpoint(""); setBucket(""); setUsername(""); setName("");
      refresh();
    } else {
      setMessage("创建失败：检查端点与凭据。");
    }
  };

  const runOnce = async (id: string) => {
    setMessage("推送中…");
    const result = await runTargetOnce(id);
    setMessage(result.ok ? `推送完成（${result.shards} 个月度分片）。` : `推送失败：${result.error ?? "未知错误"}`);
    refresh();
  };

  const reveal = async (id: string) => {
    const secret = await revealSecret(id);
    if (secret !== null) setRevealed((previous) => ({ ...previous, [id]: secret }));
  };

  const toggleEnabled = async (target: TargetView) => {
    await updateTarget(target.id, { enabled: !target.enabled });
    refresh();
  };

  const remove = async (id: string) => {
    if (!window.confirm("删除此备份目标？（远端已备份内容不受影响）")) return;
    await deleteTarget(id);
    refresh();
  };

  return (
    <section className="status-panel" aria-labelledby="backup-heading">
      <h2 id="backup-heading">远程备份（FR-BAK）</h2>
      <p className="app-description">支持 WebDAV 与 S3 兼容存储；按月分片快照 + manifest + COMPLETE 标记；append_only 绝不产生远端删除。</p>
      {message && <p className="status-detail" role="status">{message}</p>}
      {targets !== null && targets.length > 0 && (
        <ul className="mn-backuplist">
          {targets.map((target) => (
            <li key={target.id} className="mn-backuprow">
              <span className="mn-backupname">{target.name}（{target.kind} · {target.schedule} · {target.enabled ? "启用" : "停用"}）</span>
              <span className="mn-attachmeta">{target.endpoint}{target.lastResult ? ` · ${target.lastResult}` : ""}</span>
              <button type="button" className="mn-minibtn" onClick={() => void runOnce(target.id)}>推送一次</button>
              <button type="button" className="mn-minibtn" onClick={() => void toggleEnabled(target)}>{target.enabled ? "停用" : "启用"}</button>
              <button type="button" className="mn-minibtn" onClick={() => void reveal(target.id)}>
                {revealed[target.id] ? "隐藏凭据" : "查看凭据"}
              </button>
              <button type="button" className="mn-minibtn" onClick={() => void remove(target.id)}>删除</button>
              {revealed[target.id] && <code className="mn-backupsecret">{revealed[target.id]}</code>}
            </li>
          ))}
        </ul>
      )}
      {targets !== null && targets.length === 0 && <p className="status-detail">尚未配置备份目标。</p>}
      <div className="mn-backupform">
        <select className="mn-propselect" aria-label="存储类型" value={kind} onChange={(event) => setKind(event.target.value as "webdav" | "s3")}>
          <option value="webdav">WebDAV</option>
          <option value="s3">S3 兼容</option>
        </select>
        <input className="mn-propinput" placeholder="名称" aria-label="目标名称" value={name} onChange={(event) => setName(event.target.value)} />
        <input className="mn-propinput" placeholder={kind === "s3" ? "端点（如 https://s3.example.com）" : "端点（如 https://dav.example.com/dav）"} aria-label="端点" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} />
        {kind === "s3" && <input className="mn-propinput" placeholder="桶名" aria-label="桶名" value={bucket} onChange={(event) => setBucket(event.target.value)} />}
        <input className="mn-propinput" placeholder="Access Key / 用户名" aria-label="用户名" value={username} onChange={(event) => setUsername(event.target.value)} />
        <input className="mn-propinput" type="password" placeholder="Secret Key / 密码" aria-label="凭据" value={secret} onChange={(event) => setSecret(event.target.value)} />
        <select className="mn-propselect" aria-label="调度" value={schedule} onChange={(event) => setSchedule(event.target.value as "manual" | "daily" | "weekly")}>
          <option value="manual">仅手动</option>
          <option value="daily">每日</option>
          <option value="weekly">每周</option>
        </select>
        <button type="button" className="mn-auth-submit" onClick={() => void create()}>添加目标</button>
      </div>
    </section>
  );
}
