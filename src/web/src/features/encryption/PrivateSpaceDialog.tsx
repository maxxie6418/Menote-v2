import { useEffect, useRef, useState } from "react";
import { generateRecoveryCode } from "../../services/cryptoService";
import { isTopicUnlocked } from "../../services/keyringService";
import {
  findPrivateSpace, privateSpaceReady, recoveryWrapExists, setupPrivateSpace, unlockPrivateSpace,
} from "../../services/privateSpaceService";

/** 私人空间入口（FR-ENC-1/3/6）：未设密码则设定；已设则解锁。恢复码全账户只有一枚。 */
export function PrivateSpaceDialog({ userId, onOpened, onCancel }: {
  userId: string;
  onOpened: (topicId: string) => void;
  onCancel: () => void;
}) {
  const openedRef = useRef(onOpened);
  openedRef.current = onOpened;
  const [mode, setMode] = useState<"loading" | "setup" | "unlock" | "code">("loading");
  const [hasRecovery, setHasRecovery] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recovery, setRecovery] = useState("");
  const [generated, setGenerated] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [topicId, setTopicId] = useState<string | null>(null);
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
      setHasRecovery(await recoveryWrapExists());
      setGenerated(generateRecoveryCode());
      setMode("setup");
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const submitSetup = async () => {
    if (password.length < 8) { setError("密码至少 8 位。"); return; }
    if (password !== confirm) { setError("两次输入的密码不一致。"); return; }
    if (hasRecovery && !recovery.trim()) { setError("请输入已有的恢复码。"); return; }
    setBusy(true);
    setError(null);
    try {
      const topic = await setupPrivateSpace(userId, password, hasRecovery ? recovery.trim() : generated);
      setTopicId(topic.id);
      if (hasRecovery) openedRef.current(topic.id);
      else setMode("code");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "设置失败，请重试。");
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

  if (mode === "code") {
    return (
      <div className="mn-overlay" role="presentation">
        <div className="mn-dialog" role="dialog" aria-modal="true" aria-label="恢复码">
          <div className="mn-dialog-head"><p className="mn-dialog-title">恢复码（仅此一次展示）</p></div>
          <div className="mn-dialog-body">
            <p className="mn-codebox">{generated}</p>
            <p className="mn-auth-hint mn-danger-text">
              这枚恢复码同时用于单篇加密和私人空间。遗失后，对应内容永久不可解；泄漏则全部加密内容暴露。请抄写到安全处，它不会被保存。
            </p>
            <label className="mn-propmulti-option">
              <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
              我已抄写并妥善保存恢复码
            </label>
          </div>
          <div className="mn-dialog-actions">
            <button type="button" className="mn-auth-submit" disabled={!acknowledged || !topicId} aria-disabled={!acknowledged || !topicId}
              onClick={() => { if (topicId) openedRef.current(topicId); }}>
              我已保存，进入私人空间
            </button>
          </div>
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
              ? "空间密码与登录密码、单篇密码相互独立。本账户已有恢复码，请输入那一枚，不会另发新码。"
              : "空间密码与登录密码相互独立。接下来会生成一枚恢复码，单篇加密也会共用它。"}
          </p>
          <label className="mn-auth-field"><span>空间密码（至少 8 位）</span>
            <input type="password" value={password} autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} />
          </label>
          <label className="mn-auth-field"><span>再次输入密码</span>
            <input type="password" value={confirm} autoComplete="new-password" onChange={(event) => setConfirm(event.target.value)} />
          </label>
          {hasRecovery && (
            <label className="mn-auth-field"><span>已有恢复码</span>
              <input type="password" value={recovery} autoComplete="off" onChange={(event) => setRecovery(event.target.value)} />
            </label>
          )}
          {error && <p className="mn-auth-error" role="alert">{error}</p>}
        </div>
        <div className="mn-dialog-actions">
          <button type="button" className="mn-auth-submit" disabled={busy} aria-disabled={busy} onClick={() => void submitSetup()}>
            {hasRecovery ? "设置并解锁" : "设置并生成恢复码"}
          </button>
          <button type="button" className="mn-auth-link" onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  );
}
