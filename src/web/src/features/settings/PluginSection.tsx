import { useEffect, useState } from "react";
import { DEFAULT_RAINDROP_SETTINGS, normalizeRaindropSettings, type RaindropSettings } from "@menote/shared";
import { Bookmark } from "../../icons";
import { readRaindropSettings, updateRaindropSettings } from "../../services/raindropSettingsService";
import { loadShared, peek, SETTINGS_CACHE } from "../../services/settingsPrefetch";
import { PluginSettingsRow } from "./PluginSettingsRow";
import { RaindropPanel } from "./RaindropPanel";
import { MemoryPlugin } from "./MemoryPlugin";

export function PluginSection({ userId, mobile }: { userId: string; mobile: boolean }) {
  return <ul className="mn-plugin-list" aria-label="内置插件">
    <RaindropPlugin key={userId} userId={userId} mobile={mobile} />
    <MemoryPlugin key={`memory:${userId}`} userId={userId} mobile={mobile} />
  </ul>;
}

function RaindropPlugin({ userId, mobile }: { userId: string; mobile: boolean }) {
  const [settings, setSettings] = useState<RaindropSettings | null>(() => {
    const cached = peek<RaindropSettings | null>(SETTINGS_CACHE.raindrop(userId));
    return cached === undefined ? null : normalizeRaindropSettings(cached ?? DEFAULT_RAINDROP_SETTINGS);
  });
  const [readAttempt, setReadAttempt] = useState(0);
  const [readFailed, setReadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let latestRead = 0;
    const refresh = async (fresh: boolean) => {
      const read = ++latestRead;
      try {
        const value = await loadShared(SETTINGS_CACHE.raindrop(userId), () => readRaindropSettings(userId), fresh);
        if (cancelled || read !== latestRead) return;
        setSettings(normalizeRaindropSettings(value ?? DEFAULT_RAINDROP_SETTINGS));
        setReadFailed(false);
      } catch {
        if (!cancelled && read === latestRead) setReadFailed(true);
      }
    };
    void refresh(readAttempt > 0);
    const onChange = () => { void refresh(true); };
    window.addEventListener("menote:raindrop-settings", onChange);
    return () => { cancelled = true; window.removeEventListener("menote:raindrop-settings", onChange); };
  }, [readAttempt, userId]);

  const toggle = async (enabled: boolean) => {
    setSaving(true);
    setSaveFailed(false);
    try {
      setSettings(await updateRaindropSettings(userId, { enabled }));
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return <PluginSettingsRow name="Raindrop 连接器" description="在 Raindrop 与多维表格之间同步收藏。"
    icon={Bookmark} mobile={mobile} enabled={settings?.enabled ?? null} saving={saving} readFailed={readFailed}
    saveFailed={saveFailed} onToggle={(enabled) => void toggle(enabled)} onRetry={() => {
      setReadFailed(false);
      setReadAttempt((attempt) => attempt + 1);
    }} renderConfig={(active) => <RaindropPanel userId={userId} active={active} />} />;
}
