import { AuthGate } from "./features/auth";
import { AppShell } from "./app/AppShell";
import { PerfPanel } from "./features/perf";
import { ConfirmDialogHost } from "./components/ui/ConfirmDialog";
import { isPerfRequested } from "./lib/perfProbe";
import { MemoCaptureProvider } from "./features/memo";

/* 应用装配入口（禁业务逻辑）；认证门在最外层，主界面拿到会话用户与登出回调。 */
export default function App() {
  return (
    <>
      <AuthGate>{(user, onLogout) => (
        <MemoCaptureProvider key={user.id} userId={user.id}>
          <AppShell user={user} onLogout={onLogout} />
        </MemoCaptureProvider>
      )}</AuthGate>
      {/* 全局确认/输入/提示窗宿主（confirmDialog/promptDialog/alertDialog 的渲染端）。 */}
      <ConfirmDialogHost />
      {/* 性能诊断面板仅诊断模式挂载（FR-EDT-10 / W0），生产路径不渲染。 */}
      {isPerfRequested() && <PerfPanel />}
    </>
  );
}
