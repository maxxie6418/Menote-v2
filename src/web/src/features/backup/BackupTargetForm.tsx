import { useState, type FormEvent } from "react";
import { DEFAULT_BACKUP_RETENTION, MAX_BACKUP_RETENTION } from "@menote/shared";
import { createTarget, testTarget } from "../../services/backupService";

export function BackupTargetForm({ onCreated }: { onCreated: (message: string) => Promise<void> }) {
  const [kind, setKind] = useState<"webdav" | "s3">("webdav");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const value = (name: string) => String(fields.get(name) ?? "");
    const connection = { kind, endpoint: value("endpoint").trim(), bucket: kind === "s3" ? value("bucket") : null,
      username: value("username") || null, secret: value("secret"), remotePath: value("path").trim() || "menote" };
    const schedule = value("schedule") as "manual" | "daily" | "weekly";
    setBusy(true);
    try {
      if (((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value === "test") {
        setMessage("正在测试连接…");
        const result = await testTarget(connection);
        setMessage(result.ok ? "连接成功，远端读写权限可用。" : `连接失败：${result.error ?? "请检查端点与凭据。"}`);
      } else {
        const ok = await createTarget({ ...connection, schedule, name: value("name").trim() || undefined, retentionCount: Number(value("retention")) });
        if (ok) await onCreated(schedule === "manual" ? "备份位置已添加。" : "备份位置已添加，首次备份已安排。");
        else setMessage("添加失败，请检查端点与凭据。");
      }
    } finally { setBusy(false); }
  }

  return <form className="bk-card bk-form" onSubmit={event => void submit(event)}>
    <label>存储类型<select className="mn-propselect" value={kind} onChange={e => setKind(e.target.value as typeof kind)}>
      <option value="webdav">WebDAV</option><option value="s3">S3 兼容</option>
    </select></label>
    <label>名称<input className="mn-propinput" name="name" placeholder="备份位置名称" /></label>
    <label className="bk-full">服务地址<input className="mn-propinput" name="endpoint" type="url" required
      placeholder={kind === "s3" ? "https://s3.example.com" : "https://dav.example.com/dav"} /></label>
    {kind === "s3" && <label className="bk-full">存储桶<input className="mn-propinput" name="bucket" required /></label>}
    <label>{kind === "s3" ? "Access Key" : "用户名"}<input className="mn-propinput" name="username" autoComplete="off" /></label>
    <label>{kind === "s3" ? "Secret Key" : "密码"}<input className="mn-propinput" name="secret" type="password" autoComplete="new-password" required /></label>
    <label className="bk-full">远端目录<input className="mn-propinput" name="path" defaultValue="menote" /></label>
    <label>备份频率<select className="mn-propselect" name="schedule" defaultValue="daily">
      <option value="manual">仅手动</option><option value="daily">每天</option><option value="weekly">每周</option>
    </select></label>
    <label>保留上限（份）<input className="mn-propinput" name="retention" type="number" min="0" max={MAX_BACKUP_RETENTION} required defaultValue={DEFAULT_BACKUP_RETENTION} /></label>
    <p className="bk-meta bk-full">0 表示不限。超额时优先清理旧的未完成备份。</p>
    {message && <p role="status" className="bk-notice bk-full">{message}</p>}
    <div className="bk-actions bk-full">
      <button className="mn-textbtn bk-primary" type="submit" value="create" disabled={busy}>添加备份位置</button>
      <button className="mn-textbtn bk-outline" type="submit" value="test" disabled={busy}>测试连接</button>
    </div>
  </form>;
}
