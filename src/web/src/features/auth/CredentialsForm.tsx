import { useState, type FormEvent } from "react";
import { PASSWORD_MIN, USERNAME_MAX } from "@menote/shared";
import { type AuthRequestResult, submitCredentials } from "../../services/authService";
import { authErrorText } from "./messages";

interface CredentialsFormProps {
  /** 提交目标：引导创建 owner / 登录 / 开放注册。 */
  action: "/api/auth/bootstrap" | "/api/auth/login" | "/api/auth/register";
  title: string;
  /** 引导与注册需要二次输入口令；登录不需要。 */
  confirm?: boolean;
  submitLabel: string;
  hint?: string;
  footer?: React.ReactNode;
  onAuthenticated: (result: AuthRequestResult) => void;
}

/** 用户名+口令表单（引导/登录/注册三态共用）；提交经 services，禁止直连网络以外的层。 */
export function CredentialsForm({ action, title, confirm, submitLabel, hint, footer, onAuthenticated }: CredentialsFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (confirm && password !== passwordAgain) {
      setError("两次输入的口令不一致。");
      return;
    }
    setBusy(true);
    try {
      const result = await submitCredentials(action, { username: username.trim(), password });
      if (result.ok) onAuthenticated(result);
      else setError(authErrorText(result.code));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mn-auth" aria-labelledby="mn-auth-title">
      <form className="mn-auth-card" onSubmit={submit}>
        <span className="mn-brand mn-auth-brand"><img className="mn-logo" src="/icon.svg" alt="" />Menote</span>
        <h1 id="mn-auth-title" className="mn-auth-title">{title}</h1>
        {hint && <p className="mn-auth-hint">{hint}</p>}
        <label className="mn-auth-field">
          <span>用户名</span>
          <input
            value={username} onChange={(event) => setUsername(event.target.value)} required autoFocus
            autoComplete="username" maxLength={USERNAME_MAX} disabled={busy}
          />
        </label>
        <label className="mn-auth-field">
          <span>口令</span>
          <input
            type="password" value={password} onChange={(event) => setPassword(event.target.value)} required
            autoComplete={confirm ? "new-password" : "current-password"}
            minLength={import.meta.env.DEV && username.trim() === "admin" && password === "admin" ? 1 : PASSWORD_MIN}
            disabled={busy}
          />
        </label>
        {confirm && (
          <label className="mn-auth-field">
            <span>再次输入口令</span>
            <input
              type="password" value={passwordAgain} onChange={(event) => setPasswordAgain(event.target.value)}
              required autoComplete="new-password"
              minLength={import.meta.env.DEV && username.trim() === "admin" && password === "admin" ? 1 : PASSWORD_MIN}
              disabled={busy}
            />
          </label>
        )}
        {error && <p className="mn-auth-error" role="alert">{error}</p>}
        <button type="submit" className="mn-auth-submit" disabled={busy} aria-disabled={busy}>
          {busy ? "处理中…" : submitLabel}
        </button>
        {footer}
      </form>
    </section>
  );
}
