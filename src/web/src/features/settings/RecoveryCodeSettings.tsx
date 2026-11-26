import { useState } from "react";
import { createRecoveryCodeRotation, rotateRecoveryCode } from "../../services/recoveryCodeService";

const ERRORS: Record<string, string> = {
  recovery_rotation_empty: "这个账户还没有设置恢复码。首次开启加密时会生成恢复码。",
  recovery_rotation_format: "请输入完整的旧恢复码，保留连字符。",
  recovery_code_mismatch: "至少有一个加密条目或私人空间未能验证。请检查输入，并补全曾用的其他恢复码。",
  recovery_code_wrap_missing: "存在缺少恢复码包装的加密内容。请先在原设备完成同步。",
  recovery_rotation_sync_required: "本机还有改动没有同步成功。请在「同步」中处理后重试。",
  recovery_rotation_conflict: "账户的加密内容或恢复码刚有变动。请核对正在使用的恢复码，再重试。",
  recovery_rotation_unconfirmed: "暂时无法确认换码结果。请保留新旧恢复码，重试即可确认这次操作。",
  recovery_code_unavailable: "暂时无法读取账户恢复码状态。请检查网络后重试。",
  recovery_lock_unavailable: "此浏览器暂不支持安全换码，请使用支持 Web Locks 的浏览器。",
};

export function RecoveryCodeSettings({ userId, encryptedCount }: { userId: string; encryptedCount: number }) {
  const [next, setNext] = useState<{ id: string; code: string } | null>(null);
  const [codes, setCodes] = useState<string[]>([""]);
  const [confirmed, setConfirmed] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const cancel = () => {
    setNext(null);
    setCodes([""]);
    setConfirmed(false);
    setError("");
  };

  const rotate = async () => {
    if (!next || !confirmed || working || !codes.some((code) => code.trim())) return;
    setWorking(true);
    setError("");
    try {
      const result = await rotateRecoveryCode(userId, codes, next);
      cancel();
      setNotice(result === "synced"
        ? "恢复码已更换。其他设备同步后使用新码。"
        : "恢复码已更换。本机同步尚未完成，请同步后再用新码解锁。");
    } catch (cause) {
      const message = cause instanceof Error ? ERRORS[cause.message] : null;
      setError(message || "无法确认换码结果。请保留新旧恢复码后重试。");
    } finally {
      setWorking(false);
    }
  };

  return <section className="mn-settings-card mn-settings-status" aria-label="账户恢复码">
    <div className="mn-settings-heading">
      <div>
        <h3>账户恢复码</h3>
        <p className="mn-sethint">恢复码可解锁账户内的全部加密内容，请保存在安全的位置。已生成的恢复码无法从账户找回。</p>
      </div>
      {!next && <button className="mn-textbtn mn-settings-outline" type="button" onClick={() => {
        setNotice("");
        setNext(createRecoveryCodeRotation());
      }}>更换恢复码</button>}
    </div>
    <p className="mn-sethint">已加密 {encryptedCount} 篇。首次启用加密时生成恢复码。</p>
    {next && <form className="mn-recovery-rotation" autoComplete="off" onSubmit={(event) => {
      event.preventDefault();
      void rotate();
    }}>
      <p className="mn-sethint">请输入仍用于加密内容的旧恢复码。旧版本如曾生成多枚，可以一起填写。</p>
      {codes.map((code, index) => <label className="mn-recovery-code-field" key={index}>
        <span>旧恢复码 {index + 1}</span>
        <input className="mn-propinput" type="password" autoComplete="off" spellCheck={false}
          disabled={working} value={code} onChange={(event) => {
            const value = event.target.value;
            setCodes((previous) => previous.map((entry, position) => position === index ? value : entry));
          }} />
      </label>)}
      <div className="mn-set-actions">
        <button className="mn-textbtn" type="button" disabled={working}
          onClick={() => setCodes((previous) => [...previous, ""])}>添加旧恢复码</button>
        {codes.length > 1 && <button className="mn-textbtn" type="button" disabled={working}
          onClick={() => setCodes((previous) => previous.slice(0, -1))}>移除最后一项</button>}
      </div>
      <div className="mn-recovery-code-field">
        <span>新恢复码</span>
        <code>{next.code}</code>
      </div>
      <p className="mn-sethint">建议先同步其他设备。更换完成后，已同步的内容使用新码，旧备份及尚未上传的加密内容可能仍需旧码。</p>
      <label className="mn-recovery-confirm">
        <input type="checkbox" checked={confirmed} disabled={working}
          onChange={(event) => setConfirmed(event.target.checked)} />
        <span>我已保存新恢复码</span>
      </label>
      <div className="mn-set-actions">
        <button type="submit" className="mn-auth-submit"
          disabled={working || !confirmed || !codes.some((code) => code.trim())}>
          {working ? "正在验证并更换…" : "确认更换"}
        </button>
        <button className="mn-textbtn" type="button" disabled={working} onClick={cancel}>关闭</button>
      </div>
    </form>}
    {error && <p className="mn-auth-error" role="alert">{error}</p>}
    {notice && <p className="mn-sethint" role="status">{notice}</p>}
  </section>;
}
