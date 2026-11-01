import { useCallback, useEffect, useState } from "react";
import {
  type TargetView, createTarget, deleteRemoteBackup, deleteTarget, listRemoteBackups, listTargets, revealSecret, runTargetOnce, testSavedTarget, testTarget, updateTarget,
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
  const [remotePath, setRemotePath] = useState("menote");
  const [retentionCount, setRetentionCount] = useState("0");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [remoteBackups, setRemoteBackups] = useState<Record<string, Array<{ id: string; lastModified: string | null; complete: boolean }>>>({});
  const [testing, setTesting] = useState(false);
  const [testingTarget, setTestingTarget] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const refresh = useCallback(() => {
    listTargets().then(setTargets);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const create = async () => {
    setMessage(null);
    const ok = await createTarget({ kind, endpoint, bucket: bucket || null, username: username || null, secret, schedule, name: name || undefined, remotePath, retentionCount: Math.max(0, Number.parseInt(retentionCount, 10) || 0) });
    if (ok) {
      setSecret(""); setEndpoint(""); setBucket(""); setUsername(""); setName(""); setRemotePath("menote"); setRetentionCount("0");
      refresh();
    } else {
      setMessage("创建失败：检查端点与凭据。");
    }
  };

  const testConnection = async () => {
    setTesting(true); setMessage("正在测试连接…");
    const result = await testTarget({ kind, endpoint, bucket: bucket || null, username: username || null, secret, remotePath });
    setMessage(result.ok ? "连接成功：已验证写入、读取和删除测试文件。" : `连接测试失败：${result.error ?? "未知错误"}`);
    setTesting(false);
  };

  const testExistingConnection = async (target: TargetView) => {
    setTestingTarget(target.id); setMessage(`正在测试「${target.name}」连接…`);
    const result = await testSavedTarget(target.id);
    setMessage(result.ok ? `「${target.name}」连接成功：读写、列表与删除权限可用。` : `「${target.name}」连接测试失败：${result.error ?? "未知错误"}`);
    setTestingTarget(null);
  };

  const toggleRemoteBackups = async (target: TargetView) => {
    if (expanded === target.id) { setExpanded(null); return; }
    setExpanded(target.id);
    const result = await listRemoteBackups(target.id);
    if (result.error) setMessage(`读取远端目录失败：${result.error}`);
    else setRemoteBackups((previous) => ({ ...previous, [target.id]: result.backups }));
  };

  const removeRemoteBackup = async (target: TargetView, backupId: string) => {
    if (!window.confirm(`永久删除远端备份文件夹 ${target.remotePath}/${backupId}/？此操作不会删除本地数据，且无法撤销。`)) return;
    const result = await deleteRemoteBackup(target.id, backupId);
    if (!result.ok) setMessage(`删除远端备份失败：${result.error ?? "未知错误"}`);
    else setRemoteBackups((previous) => ({ ...previous, [target.id]: (previous[target.id] ?? []).filter((backup) => backup.id !== backupId) }));
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
      <p className="app-description">每条目标独立保存到自己的路径；每次推送生成带校验信息的完整快照文件夹，自动保留上限可按目标设置。</p>
      {message && <p className="status-detail" role="status">{message}</p>}
      {targets !== null && targets.length > 0 && (
        <ul className="mn-backuplist">
          {targets.map((target) => (
            <li key={target.id} className="mn-backuprow">
              <span className="mn-backupname">{target.name}（{target.kind} · {target.schedule === "manual" ? "手动推送" : `每${target.schedule === "daily" ? "日" : "周"}自动推送`} · {target.enabled ? "启用" : "停用"}）</span>
              <span className="mn-attachmeta">{target.endpoint}/{target.remotePath}/ · 保留 {target.retentionCount === 0 ? "不限" : `${target.retentionCount} 份`} · 最近推送 {target.lastPushedAt ? new Date(target.lastPushedAt).toLocaleString() : "从未"}{target.lastResult ? ` · ${target.lastResult}` : ""}</span>
              <button type="button" className="mn-minibtn" onClick={() => void runOnce(target.id)}>推送一次</button>
              <button type="button" className="mn-minibtn" disabled={testingTarget === target.id} onClick={() => void testExistingConnection(target)}>{testingTarget === target.id ? "测试中…" : "测试连接"}</button>
              <button type="button" className="mn-minibtn" onClick={() => void toggleRemoteBackups(target)}>{expanded === target.id ? "收起远端备份" : "查看远端备份"}</button>
              <button type="button" className="mn-minibtn" onClick={() => void toggleEnabled(target)}>{target.enabled ? "停用" : "启用"}</button>
              <button type="button" className="mn-minibtn" onClick={() => void reveal(target.id)}>
                {revealed[target.id] ? "隐藏凭据" : "查看凭据"}
              </button>
              <button type="button" className="mn-minibtn" onClick={() => void remove(target.id)}>删除</button>
              {revealed[target.id] && <code className="mn-backupsecret">{revealed[target.id]}</code>}
              {expanded === target.id && <div className="mn-backupsecret">
                <strong>远端目录：{target.remotePath}/</strong>
                {(remoteBackups[target.id] ?? []).length === 0 ? <p>目录为空或尚未推送。</p> : (remoteBackups[target.id] ?? []).map((backup) => <div key={backup.id} className="mn-backuprow">
                  <code>{target.remotePath}/{backup.id}/</code><span>{backup.complete ? "COMPLETE 标记存在" : "缺少 COMPLETE 标记"}{backup.lastModified ? ` · ${backup.lastModified}` : ""}</span>
                  <button type="button" className="mn-minibtn" onClick={() => void removeRemoteBackup(target, backup.id)}>删除远端内容</button>
                </div>)}
              </div>}
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
        <input className="mn-propinput" placeholder="远端目录（默认 menote）" aria-label="远端目录" value={remotePath} onChange={(event) => setRemotePath(event.target.value)} />
        <input className="mn-propinput" type="number" min="0" max="1000" placeholder="保留数量（0=不限）" aria-label="保留数量上限" value={retentionCount} onChange={(event) => setRetentionCount(event.target.value)} />
        <select className="mn-propselect" aria-label="调度" value={schedule} onChange={(event) => setSchedule(event.target.value as "manual" | "daily" | "weekly")}>
          <option value="manual">仅手动</option>
          <option value="daily">每日</option>
          <option value="weekly">每周</option>
        </select>
        <button type="button" className="mn-minibtn" disabled={testing} onClick={() => void testConnection()}>{testing ? "测试中…" : "测试连接"}</button>
        <button type="button" className="mn-auth-submit" onClick={() => void create()}>添加备份路径</button>
      </div>
    </section>
  );
}
