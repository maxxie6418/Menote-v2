import { useEffect, useState } from "react";
import { Lock } from "../../icons";
import { generateRecoveryCode } from "../../services/cryptoService";
import { NOTE_PASSWORD_MIN } from "../../services/encryptionCommandService";
import { recoveryCodeExists } from "../../services/recoveryCodeService";
import { requestSyncNow } from "../../services/syncEngine";

/** 启用单篇加密（FR-ENC-2/3/6）：独立单篇密码；恢复码生成并一次性展示（明文永不入库）。 */
export function EncryptSetupDialog({ userId, onConfirm, onCancel }: {
  userId: string;
  onConfirm: (password: string, recoveryCode: string) => Promise<"ok" | "error">;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code] = useState(() => generateRecoveryCode());
  const [existingCode, setExistingCode] = useState("");
  const [hasRecovery, setHasRecovery] = useState<boolean | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void requestSyncNow(userId).then((ok) => {
      if (!ok) throw new Error("sync_failed");
      return recoveryCodeExists(userId);
    }).then((value) => { if (active) setHasRecovery(value); })
      .catch(() => { if (active) setError("无法检查恢复码包装，请先完成同步后重试。"); });
    return () => { active = false; };
  }, [userId]);

  return (
    <div className="mn-overlay" role="presentation">
      <div className="mn-dialog" role="dialog" aria-modal="true" aria-label="启用单篇加密">
        <div className="mn-dialog-head"><p className="mn-dialog-title">启用单篇加密</p></div>
        <div className="mn-dialog-body">
          <p className="mn-auth-hint">单篇密码与登录密码、空间密码相互独立，至少 {NOTE_PASSWORD_MIN} 位。正文加密，标题保持明文；目前不支持含附件的笔记加密，请先移除附件引用。</p>
          {hasRecovery === null && !error && <p className="mn-auth-hint">正在同步并检查账户恢复码…</p>}
          <label className="mn-auth-field"><span>单篇密码（至少 {NOTE_PASSWORD_MIN} 位）</span>
            <input type="password" value={password} autoComplete="new-password" minLength={NOTE_PASSWORD_MIN} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <label className="mn-auth-field"><span>再次输入密码</span>
            <input type="password" value={confirm} autoComplete="new-password" onChange={(event) => setConfirm(event.target.value)} />
          </label>
          {hasRecovery === true && <label className="mn-auth-field"><span>已有恢复码</span>
            <input type="password" value={existingCode} autoComplete="off" onChange={(event) => setExistingCode(event.target.value)} />
          </label>}
          {hasRecovery === false && <>
            <p className="mn-auth-hint mn-danger-text">首次启用加密，请先妥善保存以下恢复码。密码遗失后只能用恢复码解锁；恢复码明文不会保存。</p>
            <p className="mn-codebox">{code}</p>
            <label className="mn-propmulti-option"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />我已抄写并妥善保存恢复码</label>
          </>}
          {error && <p className="mn-auth-error" role="alert">{error}</p>}
        </div>
        <div className="mn-dialog-actions">
          <button type="button" className="mn-auth-submit" disabled={busy || hasRecovery === null} aria-disabled={busy || hasRecovery === null}
            onClick={async () => {
              if (password.length < NOTE_PASSWORD_MIN) { setError(`密码至少 ${NOTE_PASSWORD_MIN} 位。`); return; }
              if (password !== confirm) { setError("两次输入的密码不一致。"); return; }
              if (hasRecovery && !existingCode.trim()) { setError("请输入已有恢复码。"); return; }
              if (!hasRecovery && !acknowledged) { setError("请先保存恢复码并确认。"); return; }
              setBusy(true);
              setError(null);
              try {
                const result = await onConfirm(password, hasRecovery ? existingCode.trim() : code);
                if (result === "ok") onCancel();
                else setError("加密失败，请重试。");
              } catch (cause) {
                const message = cause instanceof Error ? cause.message : "";
                if (message === "attachment_encryption_unsupported") setError("含附件的笔记暂不能加密，请先移除附件引用。");
                else if (message === "encryption_pending_sync") setError("笔记还有未同步的修改，请先完成同步后再加密。");
                else if (message === "recovery_code_mismatch") {
                  setHasRecovery(true);
                  setError("请输入账号已有的恢复码。如果旧版本曾生成多枚恢复码，请保留每一枚。");
                }
                else if (message === "recovery_code_unavailable") setError("暂时无法确认账户恢复码，请检查连接后重试。");
                else if (message === "recovery_wrap_missing") setError("现有加密内容的密钥包装尚未就绪，请先完成同步。");
                else if (message === "recovery_lock_unavailable") setError("当前浏览器无法安全协调加密设置，请使用支持 Web Locks 的浏览器重试。");
                else setError("加密失败，请重试。");
              } finally { setBusy(false); }
            }}>
            加密
          </button>
          <button type="button" className="mn-auth-link" onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  );
}

/** 锁定态解锁面板（FR-ENC-4/6）：密码或恢复码；标题明文可辨识（列表层）。 */
export function UnlockPanel({ onUnlock, error, title = "此笔记已加密", passwordHint = "输入单篇密码解锁。", passwordPlaceholder = "单篇密码" }: {
  onUnlock: (credential: string, useRecovery: boolean) => Promise<void>;
  error: string | null;
  title?: string;
  passwordHint?: string;
  passwordPlaceholder?: string;
}) {
  const [credential, setCredential] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mn-unlockpanel">
      <span className="mn-unlockmark" aria-hidden="true"><Lock /></span>
      <h3 className="mn-unlocktitle">{title}</h3>
      <p className="mn-auth-hint">{useRecovery ? "输入恢复码解锁。" : passwordHint}</p>
      <input
        className="mn-propinput mn-unlockinput" type="password" value={credential} autoFocus
        placeholder={useRecovery ? "XXXX-XXXX-…" : passwordPlaceholder} aria-label="解锁凭据"
        onChange={(event) => setCredential(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { setBusy(true); void onUnlock(credential, useRecovery).finally(() => setBusy(false)); } }}
      />
      {error && <p className="mn-auth-error" role="alert">{error}</p>}
      <div className="mn-dialog-actions">
        <button type="button" className="mn-auth-submit" disabled={busy} aria-disabled={busy}
          onClick={() => { setBusy(true); void onUnlock(credential, useRecovery).finally(() => setBusy(false)); }}>
          解锁
        </button>
        <button type="button" className="mn-auth-link" onClick={() => setUseRecovery((value) => !value)}>
          {useRecovery ? "用密码解锁" : "用恢复码解锁"}
        </button>
      </div>
    </div>
  );
}
