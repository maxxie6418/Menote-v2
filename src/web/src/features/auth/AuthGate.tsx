import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { AuthUser } from "@menote/shared";
import { fetchAuthStatus, logout } from "../../services/authService";
import { CredentialsForm } from "./CredentialsForm";

type GatePhase = "loading" | "unavailable" | "bootstrap" | "login" | "ready";

interface GateState {
  phase: GatePhase;
  user: AuthUser | null;
  registrationOpen: boolean;
}

const INITIAL: GateState = { phase: "loading", user: null, registrationOpen: false };

/** 应用级认证门：探测阶段 → 引导 / 登录 / 放行主界面；会话失效回到登录。 */
export function AuthGate({ children }: { children: (user: AuthUser, onLogout: () => void) => ReactNode }) {
  const [state, setState] = useState<GateState>(INITIAL);

  const refresh = useCallback(async (signal: AbortSignal) => {
    const status = await fetchAuthStatus(signal);
    if (signal.aborted) return;
    if (status === "unavailable") {
      setState({ phase: "unavailable", user: null, registrationOpen: false });
      return;
    }
    setState({
      phase: status.phase === "ready" ? "ready" : status.phase,
      user: status.user,
      registrationOpen: status.registrationOpen,
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const onLogout = useCallback(() => {
    void logout().finally(() => setState({ phase: "login", user: null, registrationOpen: false }));
  }, []);

  if (state.phase === "ready" && state.user) {
    return <>{children(state.user, onLogout)}</>;
  }

  const refreshStatus = () => {
    const controller = new AbortController();
    void refresh(controller.signal);
  };

  if (state.phase === "unavailable") {
    return (
      <section className="mn-auth" aria-labelledby="mn-auth-title">
        <div className="mn-auth-card">
          <h1 id="mn-auth-title" className="mn-auth-title">服务暂不可用</h1>
          <p className="mn-auth-hint">无法确认登录状态。若为刚部署，请稍候片刻后重试。</p>
          <button type="button" className="mn-auth-submit" onClick={refreshStatus}>重试</button>
        </div>
      </section>
    );
  }

  if (state.phase === "loading") {
    return (
      <section className="mn-auth" aria-busy="true">
        <div className="mn-auth-card"><p className="mn-auth-hint">正在确认登录状态…</p></div>
      </section>
    );
  }

  if (state.phase === "bootstrap") {
    return (
      <CredentialsForm
        action="/api/auth/bootstrap"
        title="初始化 Menote"
        hint="首次部署：创建管理员账号。创建完成后本页不再出现，注册默认关闭。"
        submitLabel="创建管理员账号"
        confirm
        onAuthenticated={(result) => {
          if (result.ok) setState({ phase: "ready", user: result.user, registrationOpen: false });
        }}
      />
    );
  }

  return <CredentialsPage registrationOpen={state.registrationOpen} onAuthenticated={(user) =>
    setState({ phase: "ready", user, registrationOpen: state.registrationOpen })} />;
}

/** 登录页：owner 开放注册时提供注册切换。 */
function CredentialsPage(
  { registrationOpen, onAuthenticated }: { registrationOpen: boolean; onAuthenticated: (user: AuthUser) => void },
) {
  const [registering, setRegistering] = useState(false);
  return (
    <CredentialsForm
      action={registering ? "/api/auth/register" : "/api/auth/login"}
      title={registering ? "注册账号" : "登录 Menote"}
      submitLabel={registering ? "注册" : "登录"}
      confirm={registering}
      footer={registrationOpen ? (
        <button type="button" className="mn-auth-link" onClick={() => setRegistering((value) => !value)}>
          {registering ? "返回登录" : "没有账号？注册"}
        </button>
      ) : undefined}
      onAuthenticated={(result) => {
        if (result.ok) onAuthenticated(result.user);
      }}
    />
  );
}
