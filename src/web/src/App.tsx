import { useEffect, useState } from "react";
import type { HealthResponse } from "@menote/shared";
import { getReadiness } from "./services/health";
import { MonitorPanel } from "./features/monitor";

export default function App() {
  const [health, setHealth] = useState<HealthResponse["status"] | "checking">("checking");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setHealth("checking");
    getReadiness(controller.signal).then((value) => setHealth(value.status)).catch(() => {});
    return () => controller.abort();
  }, [attempt]);


  return <div className="app-shell">
    <header className="app-header"><span className="app-wordmark">Menote</span><span className="app-stage">部署与工程基线</span></header>
    <main className="app-main">
      <section className="status-panel" aria-labelledby="status-heading">
        <p className="app-eyebrow">MENOTE</p>
        <h1 id="status-heading">应用状态</h1>
        <p className="app-description">正在为你的笔记准备一个可靠的空间。</p>
        <div className="status-card" role="status" aria-live="polite">
          <p className="status-title">{health === "checking" ? "正在检查配置" : health === "ready" ? "基础配置已就绪" : "基础配置尚未就绪"}</p>
          <p className="status-detail">{health === "checking" ? "请稍候。" : health === "ready" ? "应用已连接所需资源。笔记功能将在后续版本开放。" : "请在 Cloudflare 检查 AUTH_PEPPER、D1、R2 和部署状态，然后重试。"}</p>
        </div>
        {health === "ready" && <MonitorPanel refresh={attempt} />}
        <button type="button" className="app-button" onClick={() => { if (health !== "checking") setAttempt((value) => value + 1); }} aria-disabled={health === "checking"}>重新检查</button>
      </section>
    </main>
  </div>;
}
