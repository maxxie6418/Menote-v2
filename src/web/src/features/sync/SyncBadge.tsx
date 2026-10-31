import { useEffect, useState } from "react";
import { getSyncPhase, subscribeSyncStatus, type SyncPhase } from "../../services/syncEngine";

const LABEL: Record<SyncPhase, string> = {
  idle: "已同步", syncing: "同步中…", error: "同步异常 · 稍后重试",
};

/** 同步状态指示（恢复设计稿「已同步」脚注；N3 出口项）。 */
export function SyncBadge() {
  const [phase, setPhase] = useState<SyncPhase>(getSyncPhase);
  useEffect(() => subscribeSyncStatus(() => setPhase(getSyncPhase())), []);
  return <span className={phase === "error" ? "mn-syncbadge err" : "mn-syncbadge"}>{LABEL[phase]}</span>;
}
