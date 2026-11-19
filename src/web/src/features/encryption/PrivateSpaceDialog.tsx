import { useEffect, useRef, useState } from "react";
import { generateRecoveryCode } from "../../services/cryptoService";
import { isTopicUnlocked } from "../../services/keyringService";
import { recoveryCodeExists } from "../../services/recoveryCodeService";
import { requestSyncNow } from "../../services/syncEngine";
import {
  findPrivateSpace, PRIVATE_SPACE_PASSWORD_MIN, privateSpaceReady, setupPrivateSpace, unlockPrivateSpace,
} from "../../services/privateSpaceService";

/** 私人空间入口（FR-ENC-1/3/6）：未设密码则设定；已设则解锁。恢复码全账户只有一枚。 */
export function PrivateSpaceDialog({ userId, onOpened, onCancel }: {
  userId: string;
  onOpened: (topicId: string) => void;
  onCancel: () => void;
}) {
  const openedRef = useRef(onOpened);
  openedRef.current = onOpened;
  const [mode, setMode] = useState<"loading" | "setup" | "unlock">("loading");
  const [hasRecovery, setHasRecovery] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recovery, setRecovery] = useState("");
  const [generated, setGenerated] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const space = await findPrivateSpace(userId);
      if (cancelled) return;
      const ready = space ? await privateSpaceReady(space.id) : false;
      if (cancelled) return;
      if (ready && space && isTopicUnlocked(space.id)) {
        openedRef.current(space.id);
        return;
      }
      if (ready) {
        setMode("unlock");
        return;
      }
      if (!await requestSyncNow(userId)) throw new Error("sync_failed");
      // 新设备同步后可能刚拉到已配置的私人空间，重新判断而不是进入设置。
      const syncedSpace = await findPrivateSpace(userId);
      if (cancelled) return;
      if (syncedSpace && await privateSpaceReady(syncedSpace.id)) {
        if (!cancelled) setMode("unlock");
        return;
      }
      setHasRecovery(await recoveryCodeExists(userId));
      setGenerated(generateRecoveryCode());
      setMode("setup");
    })().catch(() => { if (!cancelled) { setError("无法检查恢复码包装，请先完成同步后重试。"); setMode("setup"); } });
    return () => { cancelled = true; };
  }, [userId]);

  const submitSetup = async () => {
    if (password.length < PRIVATE_SPACE_PASSWORD_MIN) { setError(`密码至少 ${PRIVATE_SPACE_PASSWORD_MIN} 位。`); return; }
    if (password !== confirm) { setError("两次输入的密码不一致。"); return; }
    if (hasRecovery && !recovery.trim()) { setError("请输入已有的恢复码。"); return; }
    if (!hasRecovery && !acknowledged) { setError("请先保存恢复码并确认。"); return; }
    setBusy(true);
    setError(null);
    try {
      const topic = await setupPrivateSpace(userId, password, hasRecovery ? recovery.trim() : generated);
      openedRef.current(topic.id);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      if (message === "recovery_code_mismatch") {
        setHasRecovery(true);
        setError("请输入账号已有的恢复码。如果旧版本曾生成多枚恢复码，请保留每一枚。");
      }
      else if (message === "recovery_code_unavailable") setError("暂时无法确认账户恢复码，请检查连接后重试。");
      else if (message === "recovery_wrap_missing") setError("现有加密内容的密钥包装尚未就绪，请先完成同步。");
      else if (message === "recovery_lock_unavailable") setError("当前浏览器无法安全协调加密设置，请使用支持 Web Locks 的浏览器重试。");
      else setError(message || "设置失败，请重试。");
    } finally {
      setBusy(false);
    }
  };

  const submitUnlock = async () => {
    if (!password.trim()) { setError(useRecovery ? "请输入恢复码。" : "请输入空间密码。"); return; }
    setBusy(true);
    setError(null);
    const result = await unlockPrivateSpace(userId, password.trim(), useRecovery);
    if (result === "ok") {
      const space = await findPrivateSpace(userId);
      if (space) openedRef.current(space.id);
      else setError("私人空间不存在。");
    } else if (result === "bad_credential") setError("密码或恢复码不正确。");
    else setError("私人空间的密钥包装还没同步到本机，请稍后重试。");
    setBusy(false);
  };

  if (mode === "loading") {
    return (
      <div className="mn-overlay" role="presentation">
        <div className="mn-dialog" role="dialog" aria-modal="true" aria-label="私人空间">
          <div className="mn-dialog-body"><p className="mn-auth-hint">正在检查私人空间…</p></div>
        </div>
      </div>
    );
  }

  if (mode === "unlock") {
    return (
      <div className="mn-overlay" role="presentation">
        <div className="mn-dialog" role="dialog" aria-modal="true" aria-label="解锁私人空间">
          <div className="mn-dialog-head"><p className="mn-dialog-title">解锁私人空间</p></div>
          <div className="mn-dialog-body">
            <p className="mn-auth-hint">{useRecovery ? "输入恢复码。它与单篇加密共用。" : "空间密码与登录密码、单篇密码都不同。"}</p>
            <label className="mn-auth-field"><span>{useRecovery ? "恢复码" : "空间密码"}</span>
              <input type="password" value={password} autoFocus autoComplete="current-password" onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void submitUnlock(); }} />
            </label>
            {error && <p className="mn-auth-error" role="alert">{error}</p>}
          </div>
          <div className="mn-dialog-actions">
            <button type="button" className="mn-auth-submit" disabled={busy} aria-disabled={busy} onClick={() => void submitUnlock()}>解锁</button>
            <button type="button" className="mn-auth-link" onClick={() => { setUseRecovery((value) => !value); setError(null); }}>
              {useRecovery ? "用空间密码" : "用恢复码"}
            </button>
            <button type="button" className="mn-auth-link" onClick={onCancel}>取消</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mn-overlay" role="presentation">
      <div className="mn-dialog" role="dialog" aria-modal="true" aria-label="设置私人空间">
        <div className="mn-dialog-head"><p className="mn-dialog-title">设置私人空间</p></div>
        <div className="mn-dialog-body">
          <p className="mn-auth-hint">
            {hasRecovery
              ? `空间密码与登录密码、单篇密码相互独立，至少 ${PRIVATE_SPACE_PASSWORD_MIN} 位，不要求复杂组合。本账户已有恢复码，请输入那一枚，不会另发新码。`
              : `空间密码与登录密码相互独立，至少 ${PRIVATE_SPACE_PASSWORD_MIN} 位，不要求复杂组合。请先保存恢复码，单篇加密也会使用它。`}
          </p>
          <label className="mn-auth-field"><span>空间密码（至少 {PRIVATE_SPACE_PASSWORD_MIN} 位）</span>
            <input type="password" value={password} autoComplete="new-password" minLength={PRIVATE_SPACE_PASSWORD_MIN} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <label className="mn-auth-field"><span>再次输入密码</span>
            <input type="password" value={confirm} autoComplete="new-password" onChange={(event) => setConfirm(event.target.value)} />
          </label>
          {hasRecovery && (
            <label className="mn-auth-field"><span>已有恢复码</span>
              <input type="password" value={recovery} autoComplete="off" onChange={(event) => setRecovery(event.target.value)} />
            </label>
          )}
          {hasRecovery === false && <>
            <p className="mn-auth-hint mn-danger-text">恢复码遗失后，对应内容可能永久不可解；泄漏则加密内容可能暴露。请先抄写并妥善保存，它不会被保存到服务器。</p>
            <p className="mn-codebox">{generated}</p>
            <label className="mn-propmulti-option"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />我已抄写并妥善保存恢复码</label>
          </>}
          {error && <p className="mn-auth-error" role="alert">{error}</p>}
        </div>
        <div className="mn-dialog-actions">
          <button type="button" className="mn-auth-submit" disabled={busy || hasRecovery === null} aria-disabled={busy || hasRecovery === null} onClick={() => void submitSetup()}>
            设置并解锁
          </button>
          <button type="button" className="mn-auth-link" onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  );
}
