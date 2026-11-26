import { useEffect, useState } from "react";
import type { HealthResponse } from "@menote/shared";
import { ArrowLeft, CircleCheck, CircleHelp, CircleX } from "../icons";
import { getReadiness } from "../services/healthService";
import { MonitorPanel } from "../features/monitor";
import { SyncBadge } from "../features/sync";
import { APP_VERSION_FULL_LABEL } from "../lib/version";

interface SystemStatusPageProps {
  onBack: () => void;
  userId?: string;
}

/** 系统状态：健康自检、同步状态与分口径资源用量。 */
export function SystemStatusPage({ onBack }: SystemStatusPageProps) {
  const [health, setHealth] = useState<HealthResponse["status"] | "checking">("checking");
  const [healthAttempt, setHealthAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setHealth("checking");
    getReadiness(controller.signal).then((value) => setHealth(value.status)).catch(() => setHealth("unavailable"));
    return () => controller.abort();
  }, [healthAttempt]);

  const healthLabel = health === "checking" ? "检查中" : health === "ready" ? "服务正常" : "服务未就绪";
  const HealthIcon = health === "ready" ? CircleCheck : health === "checking" ? CircleHelp : CircleX;

  return <main className="mn-main mn-statuspage" aria-label="系统状态">
    <header className="mn-statusbar">
      <button type="button" className="mn-iconbtn" aria-label="返回主界面" onClick={onBack}><ArrowLeft /></button>
      <span className="mn-statusbar-title">系统状态</span>
      <span className="mn-statusbar-version">{APP_VERSION_FULL_LABEL}</span>
    </header>
    <section className="mn-status-content" aria-labelledby="status-heading">
      <div className="mn-status-heading">
        <div><p className="app-eyebrow">MENOTE · SYSTEM</p><h1 id="status-heading">资源概览</h1><p className="app-description">查看本地实例的服务状态和请求统计。</p></div>
        <div className={`mn-health-chip ${health === "ready" ? "is-ready" : health === "checking" ? "is-loading" : "is-error"}`}>
          <HealthIcon aria-hidden="true" /><span>{healthLabel}</span>
          <button type="button" onClick={() => setHealthAttempt((value) => value + 1)} disabled={health === "checking"}>重新检查</button>
        </div>
      </div>
      <div className="mn-status-subrow"><span>内容同步</span><SyncBadge /></div>
      <MonitorPanel />
    </section>
    <footer className="app-footer">{APP_VERSION_FULL_LABEL}</footer>
  </main>;
}
