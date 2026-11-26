import { AuthGate } from "./features/auth";
import { lazy, Suspense } from "react";
import { ConfirmDialogHost } from "./components/ui/ConfirmDialog";
import { isPerfRequested } from "./lib/perfProbe";
const PerfPanel = lazy(() => import("./features/perf").then(module => ({ default: module.PerfPanel })));
const Workspace = lazy(() => import("./app/Workspace"));

/* 应用装配入口（禁业务逻辑）；认证门在最外层，主界面拿到会话用户与登出回调。 */
export default function App() {
  return (
    <>
      <AuthGate>{(user, onLogout) => (
        <Suspense fallback={null}><Workspace key={user.id} user={user} onLogout={onLogout} /></Suspense>
      )}</AuthGate>
      {/* 全局确认/输入/提示窗宿主（confirmDialog/promptDialog/alertDialog 的渲染端）。 */}
      <ConfirmDialogHost />
      {/* 性能诊断面板仅诊断模式挂载（FR-EDT-10 / W0），生产路径不渲染。 */}
      {isPerfRequested() && <Suspense fallback={null}><PerfPanel /></Suspense>}
    </>
  );
}
