import { useState } from "react";
import { Lock } from "lucide-react";
import { generateRecoveryCode } from "../../services/cryptoService";

/** 启用单篇加密（FR-ENC-2/3/6）：独立单篇密码；恢复码生成并一次性展示（明文永不入库）。 */
export function EncryptSetupDialog({ onConfirm, onCancel }: {
  onConfirm: (password: string, recoveryCode: string) => Promise<"ok" | "error">;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState(() => generateRecoveryCode());
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<"form" | "code">("form");

  if (stage === "code") {
    return (
      <div className="mn-overlay" role="presentation">
        <div className="mn-dialog" role="dialog" aria-modal="true" aria-label="恢复码">
          <div className="mn-dialog-head"><p className="mn-dialog-title">恢复码（仅此一次展示）</p></div>
          <div className="mn-dialog-body">
            <p className="mn-codebox">{code}</p>
            <p className="mn-auth-hint mn-danger-text">
              恢复码是密码遗失时的唯一解锁途径：遗失 = 对应内容永久不可解；单码泄漏 = 全部加密内容暴露。
              请抄写到安全处（不会同步到服务器）。
            </p>
            <label className="mn-propmulti-option">
              <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
              我已抄写并妥善保存恢复码
            </label>
          </div>
          <div className="mn-dialog-actions">
            <button type="button" className="mn-auth-submit" disabled={!acknowledged || busy} aria-disabled={!acknowledged || busy}
              onClick={() => { setStage("form"); onCancel(); }}>
              完成
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mn-overlay" role="presentation">
      <div className="mn-dialog" role="dialog" aria-modal="true" aria-label="启用单篇加密">
        <div className="mn-dialog-head"><p className="mn-dialog-title">启用单篇加密</p></div>
        <div className="mn-dialog-body">
          <p className="mn-auth-hint">单篇密码与登录密码相互独立（三凭据分离）。正文与附件将始终密文存储，标题保持明文。</p>
          <label className="mn-auth-field"><span>单篇密码（至少 8 位）</span>
            <input type="password" value={password} autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} />
          </label>
          <label className="mn-auth-field"><span>再次输入密码</span>
            <input type="password" value={confirm} autoComplete="new-password" onChange={(event) => setConfirm(event.target.value)} />
          </label>
          {error && <p className="mn-auth-error" role="alert">{error}</p>}
        </div>
        <div className="mn-dialog-actions">
          <button type="button" className="mn-auth-submit" disabled={busy} aria-disabled={busy}
            onClick={async () => {
              if (password.length < 8) { setError("密码至少 8 位。"); return; }
              if (password !== confirm) { setError("两次输入的密码不一致。"); return; }
              setBusy(true);
              const result = await onConfirm(password, code);
              setBusy(false);
              if (result === "ok") setStage("code");
              else setError("加密失败，请重试。");
            }}>
            加密并生成恢复码
          </button>
          <button type="button" className="mn-auth-link" onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  );
}

/** 锁定态解锁面板（FR-ENC-4/6）：密码或恢复码；标题明文可辨识（列表层）。 */
export function UnlockPanel({ onUnlock, error }: {
  onUnlock: (credential: string, useRecovery: boolean) => Promise<void>;
  error: string | null;
}) {
  const [credential, setCredential] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mn-unlockpanel">
      <span className="mn-unlockmark" aria-hidden="true"><Lock /></span>
      <h3 className="mn-unlocktitle">此笔记已加密</h3>
      <p className="mn-auth-hint">{useRecovery ? "输入恢复码解锁。" : "输入单篇密码解锁。"}</p>
      <input
        className="mn-propinput mn-unlockinput" type="password" value={credential} autoFocus
        placeholder={useRecovery ? "XXXX-XXXX-…" : "单篇密码"} aria-label="解锁凭据"
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
