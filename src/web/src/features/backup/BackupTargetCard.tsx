import { useState } from "react";
import { MAX_BACKUP_RETENTION } from "@menote/shared";
import { confirmDialog } from "../../components/ui/ConfirmDialog";
import { ChevronDown, Clock, Folder, Settings, ArrowUp } from "../../icons";
import { deleteTarget, revealSecret, runTargetOnce, testSavedTarget, updateTarget, type TargetView } from "../../services/backupService";
import { RemoteBackupHistory } from "./RemoteBackupHistory";

type Props = { target: TargetView; userId: string; refresh: () => Promise<void> };
type Frequency = "manual" | "daily" | "weekly";

export function BackupTargetCard({ target, userId, refresh }: Props) {
  const [managing, setManaging] = useState(false);
  const [history, setHistory] = useState(false);
  const [revision, setRevision] = useState(0);
  const [secret, setSecret] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [retention, setRetention] = useState<string | null>(null);
  const [frequency, setFrequency] = useState<Frequency | null>(null);
  const limit = retention ?? String(target.retentionCount);
  const schedule = frequency ?? target.schedule;
  const changed = limit !== String(target.retentionCount) || schedule !== target.schedule;
  const successful = target.lastResult?.startsWith("ok:");
  const failure = target.lastResult?.startsWith("失败:");
  const cleanupError = successful ? target.lastResult?.split("；清理失败：")[1] : undefined;
  const detail = failure ? target.lastResult?.slice(3).trim() || "未知错误" : cleanupError;
  const lastStatus = failure ? "失败" : cleanupError ? "成功，清理未完成" : successful ? "成功" : target.lastResult ?? "尚未推送";
  const name = target.name || "备份目标";

  async function save() {
    setBusy("save");
    try {
      const ok = await updateTarget(target.id, {
        ...(retention !== null ? { retentionCount: Number(limit) } : {}),
        ...(frequency !== null ? { schedule: frequency } : {}),
      });
      if (ok) {
        await refresh(); setRetention(null); setFrequency(null);
        setMessage("策略已保存，下次推送时按此上限清理。");
      } else setMessage("保存失败，请重试。");
    } finally { setBusy(""); }
  }

  async function push() {
    setBusy("push"); setMessage("正在推送并校验备份…");
    try {
      const result = await runTargetOnce(target.id);
      setMessage(result.ok
        ? `推送完成，共 ${result.shards} 个数据分片。${result.cleanupError ? "远端清理失败，请查看错误详情。" : ""}`
        : `推送失败：${result.error}`);
      setRevision(value => value + 1);
      await refresh();
    } finally { setBusy(""); }
  }

  async function manage(action: "test" | "enabled" | "secret" | "remove") {
    if (action === "remove" && !await confirmDialog({ title: "删除备份位置", message: `删除「${name}」的连接配置？远端已有快照将保留。`, danger: true })) return;
    setBusy(action); setMessage("");
    try {
      if (action === "test") {
        const result = await testSavedTarget(target.id);
        setMessage(result.ok ? "连接成功，远端读写权限可用。" : `连接失败：${result.error ?? "未知错误"}`);
      } else if (action === "secret") {
        if (secret) setSecret("");
        else {
          const result = await revealSecret(target.id);
          if (result === null) setMessage("凭据读取失败，请重试。");
          else setSecret(result);
        }
      } else if (action === "enabled") {
        if (!await updateTarget(target.id, { enabled: !target.enabled })) setMessage("更新失败，请重试。");
        await refresh();
      } else {
        if (!await deleteTarget(target.id)) setMessage("删除失败，请重试。");
        await refresh();
      }
    } finally { setBusy(""); }
  }

  return <article className="bk-card bk-target" aria-label={name}>
    <div className="bk-target-body">
      <div className="bk-target-head">
        <span className="bk-icon"><Folder /></span>
        <div className="bk-name"><h4>{name}</h4><span className="bk-kind">{target.kind === "s3" ? "S3" : "WebDAV"}</span></div>
        <p className="bk-path">{[target.endpoint.replace(/\/+$/, ""), target.kind === "s3" ? target.bucket : null, target.remotePath].filter(Boolean).join("/")}/</p>
        <span className="bk-enabled" data-enabled={target.enabled}>{target.enabled ? "已启用" : "已停用"}</span>
      </div>
      <form className="bk-policy" onSubmit={e => { e.preventDefault(); void save(); }}>
        <label>备份频率<select className="mn-propselect" disabled={Boolean(busy)} value={schedule} onChange={e => setFrequency(e.target.value as Frequency)}>
          <option value="manual">仅手动</option><option value="daily">每天</option><option value="weekly">每周</option>
        </select></label>
        <label>保留上限<span className="bk-quantity"><input className="mn-propinput" type="number" min="0" max={MAX_BACKUP_RETENTION} required
          disabled={Boolean(busy)} value={limit} onChange={e => setRetention(e.target.value)} />{limit === "0" ? "不限" : "份"}</span></label>
        {changed && <button type="submit" className="mn-textbtn bk-outline" disabled={Boolean(busy)}>{busy === "save" ? "保存中…" : "保存策略"}</button>}
        <p className="bk-policy-hint bk-meta">0 表示不限。超额时先清理旧的未完成备份。</p>
      </form>
      <div className="bk-target-footer">
        <div className="bk-meta bk-last"><Clock />{target.lastResult ? `上次推送 · ${lastStatus}` : lastStatus}
          {target.lastPushedAt && <span>最近成功于 {new Date(target.lastPushedAt).toLocaleString("zh-CN", { hour12: false })}</span>}
        </div>
        <div className="bk-actions">
          <button type="button" className="mn-textbtn bk-primary" disabled={Boolean(busy) || !target.enabled} onClick={() => void push()}>
            <ArrowUp />{busy === "push" ? "推送中…" : "推送一次"}</button>
          <button type="button" className="mn-textbtn" aria-expanded={managing} disabled={Boolean(busy)}
            onClick={() => { setManaging(!managing); setSecret(""); }}><Settings />管理</button>
        </div>
      </div>
      {detail && <details className="bk-error"><summary>错误详情</summary><p>{detail}</p></details>}
      {managing && <div className="bk-management">
        <p className="bk-meta">自动备份每小时检查一次，按上次成功推送时间计算间隔。目标停用时暂停。</p>
        <div className="bk-actions">
          <button type="button" className="mn-textbtn" disabled={Boolean(busy)} onClick={() => void manage("test")}>{busy === "test" ? "测试中…" : "测试连接"}</button>
          <button type="button" className="mn-textbtn" disabled={Boolean(busy)} onClick={() => void manage("enabled")}>{target.enabled ? "停用目标" : "启用目标"}</button>
          <button type="button" className="mn-textbtn" disabled={Boolean(busy)} onClick={() => void manage("secret")}>{secret ? "隐藏凭据" : "查看凭据"}</button>
          <button type="button" className="mn-textbtn bk-danger" disabled={Boolean(busy)} onClick={() => void manage("remove")}>删除位置</button>
        </div>
        {secret && <code className="bk-code">{secret}</code>}
      </div>}
      {message && <p role="status" className="bk-notice">{message}</p>}
    </div>
    <button type="button" className="bk-history-toggle" aria-expanded={history} onClick={() => setHistory(!history)}>
      <span>备份记录</span><ChevronDown className="bk-chevron" />
    </button>
    {history && <RemoteBackupHistory userId={userId} target={target} revision={revision} />}
  </article>;
}
