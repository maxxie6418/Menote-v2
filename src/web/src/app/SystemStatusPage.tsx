import { useEffect, useState } from "react";
import type { HealthResponse } from "@menote/shared";
import { ArrowLeft, CircleCheck, CircleHelp, CircleX } from "lucide-react";
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

  return <div className="mn-statuspage">
    <header className="mn-statusbar">
      <button type="button" className="mn-iconbtn" aria-label="返回主界面" onClick={onBack}><ArrowLeft /></button>
      <span className="mn-statusbar-title">系统状态</span>
      <span className="mn-statusbar-version">{APP_VERSION_FULL_LABEL}</span>
    </header>
    <main className="app-main">
      <section className="mn-status-content" aria-labelledby="status-heading">
        <div className="mn-status-heading">
          <div><p className="app-eyebrow">MENOTE · SYSTEM</p><h1 id="status-heading">资源概览</h1><p className="app-description">查看当前项目在 Cloudflare 上的实际使用情况。</p></div>
          <div className={`mn-health-chip ${health === "ready" ? "is-ready" : health === "checking" ? "is-loading" : "is-error"}`}>
            <HealthIcon aria-hidden="true" /><span>{healthLabel}</span>
            <button type="button" onClick={() => setHealthAttempt((value) => value + 1)} disabled={health === "checking"}>重新检查</button>
          </div>
        </div>
        <div className="mn-status-subrow"><span>内容同步</span><SyncBadge /></div>
        <MonitorPanel />
        <p className="mn-status-footnote">官方指标由 Cloudflare Analytics API 返回，可能存在采集延迟；各资源分别按配置的项目标识筛选。费用以 Cloudflare 账单为准。</p>
      </section>
    </main>
    <footer className="app-footer">{APP_VERSION_FULL_LABEL}</footer>
  </div>;
}
