import { useEffect, useState } from "react";
import type { HealthResponse } from "@menote/shared";
import { ArrowLeft } from "lucide-react";
import { getReadiness } from "../services/healthService";
import { MonitorPanel } from "../features/monitor";
import { APP_VERSION_LABEL } from "../lib/version";
import { AttachmentListPanel } from "../features/attachments";

interface SystemStatusPageProps {
  onBack: () => void;
  /** G5：登录后提供附件管理（FR-SYNC-8）。 */
  userId?: string;
}

/* 系统状态页：健康自检、资源监控与版本信息（从 M1 应用状态页迁移）。
   数据一律经 services，UI 不直连网络。 */
export function SystemStatusPage({ onBack, userId }: SystemStatusPageProps) {
  const [health, setHealth] = useState<HealthResponse["status"] | "checking">("checking");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setHealth("checking");
    getReadiness(controller.signal).then((value) => setHealth(value.status)).catch(() => {});
    return () => controller.abort();
  }, [attempt]);

  return (
    <div className="mn-statuspage">
      <header className="mn-statusbar">
        <button type="button" className="mn-iconbtn" aria-label="返回主界面" onClick={onBack}>
          <ArrowLeft />
        </button>
        <span className="mn-statusbar-title">系统状态</span>
      </header>
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
        {userId && <AttachmentListPanel userId={userId} />}
      
      </main>
      <footer className="app-footer">{APP_VERSION_LABEL}</footer>
    </div>
  );
}
