import { useEffect, useState } from "react";
import { type MemoryPluginStatus } from "@menote/shared";
import { BrainCircuit } from "../../icons";
import { readMemoryPlugin, updateMemoryPlugin } from "../../services/memoryService";
import { PluginSettingsRow } from "./PluginSettingsRow";
import { MemoryPluginPanel } from "./MemoryPluginPanel";

export function MemoryPlugin({ userId, mobile }: { userId: string; mobile: boolean }) {
  const [status, setStatus] = useState<MemoryPluginStatus | null>(null);
  const [attempt, retry] = useState(0);
  const [readFailed, setReadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void readMemoryPlugin().then((next) => {
      if (cancelled) return;
      setStatus(next);
      setReadFailed(false);
    }).catch(() => { if (!cancelled) setReadFailed(true); });
    return () => { cancelled = true; };
  }, [userId, attempt]);

  async function toggle(enabled: boolean) {
    setSaving(true);
    setSaveFailed(false);
    try { setStatus(await updateMemoryPlugin(enabled)); }
    catch { setSaveFailed(true); }
    finally { setSaving(false); }
  }

  return <PluginSettingsRow name="AI 记忆库" description="让 Agent 共用个人和项目记忆。"
    icon={BrainCircuit} mobile={mobile} enabled={status?.enabled ?? null} saving={saving} readFailed={readFailed}
    saveFailed={saveFailed} onToggle={(enabled) => void toggle(enabled)} onRetry={() => retry((value) => value + 1)}
    renderConfig={() => status && <MemoryPluginPanel userId={userId} status={status} onChange={setStatus} />} />;
}
