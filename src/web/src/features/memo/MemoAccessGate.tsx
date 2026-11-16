import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { LockKeyhole } from "../../icons";
import { readAppearance } from "../../services/appearanceSettingsService";
import { verifyPrivateSpacePassword } from "../../services/privateSpaceService";

/** Frontend-only entry prompt; Memo content remains plain and this does not unlock the private space. */
export function MemoAccessGate({ userId, children, lockedAs = "div", lockedClassName = "mn-memo-access-screen", lockedLabel }: {
  userId: string;
  children: ReactNode;
  lockedAs?: "div" | "main";
  lockedClassName?: string;
  lockedLabel?: string;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const enabledRef = useRef<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const next = (await readAppearance(userId))?.memoAccessGate === true;
        if (cancelled) return;
        const previous = enabledRef.current;
        enabledRef.current = next;
        setLoadFailed(false);
        setEnabled(next);
        if (previous === null || previous !== next) setUnlocked(!next);
      } catch {
        if (!cancelled) {
          setLoadFailed(true);
          setEnabled(null);
        }
      }
    };
    void refresh();
    window.addEventListener("menote:appearance", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("menote:appearance", refresh);
    };
  }, [userId]);

  const LockedContainer = lockedAs;
  if (enabled === null) {
    return <LockedContainer className={lockedClassName} aria-label={lockedLabel}><p role="status">{loadFailed ? "无法读取 Memo 入口设置，请刷新页面后重试。" : "正在读取 Memo 入口设置…"}</p></LockedContainer>;
  }
  if (!enabled || unlocked) return children;
  return (
    <LockedContainer className={lockedClassName} aria-label={lockedLabel}>
      <MemoAccessPrompt userId={userId} onUnlocked={() => setUnlocked(true)} />
    </LockedContainer>
  );
}

function MemoAccessPrompt({ userId, onUnlocked }: { userId: string; onUnlocked: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password.length === 0) {
      setError("请输入私人空间密码。");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await verifyPrivateSpacePassword(userId, password);
      if (result === "ok") {
        setPassword("");
        onUnlocked();
      } else if (result === "bad_credential") {
        setError("私人空间密码不正确。");
      } else {
        setError("本机没有可用的私人空间密码包装，请先同步私人空间后重试。");
      }
    } catch {
      setError("校验失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mn-memo-access-card" aria-label="Memo 入口口令验证">
      <LockKeyhole aria-hidden="true" />
      <h1>输入私人空间密码</h1>
      <p>验证后进入 Memo。此设置只拦截前端入口，Memo 正文和附件仍以明文存储与同步。</p>
      <form onSubmit={(event) => void submit(event)}>
        <label className="mn-auth-field">
          <span>私人空间密码</span>
          <input
            type="password"
            value={password}
            autoFocus
            autoComplete="off"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error && <p className="mn-auth-error" role="alert">{error}</p>}
        <button type="submit" className="mn-auth-submit" disabled={busy}>
          {busy ? "正在验证…" : "进入 Memo"}
        </button>
      </form>
    </section>
  );
}
