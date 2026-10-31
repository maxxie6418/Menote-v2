import { AuthGate } from "./features/auth";
import { AppShell } from "./app/AppShell";

/* 应用装配入口（禁业务逻辑）；认证门在最外层，主界面拿到会话用户与登出回调。 */
export default function App() {
  return <AuthGate>{(user, onLogout) => <AppShell user={user} onLogout={onLogout} />}</AuthGate>;
}
