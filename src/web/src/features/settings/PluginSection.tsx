import { useEffect, useState } from "react";
import { DEFAULT_RAINDROP_SETTINGS, normalizeRaindropSettings, type RaindropSettings } from "@menote/shared";
import { readRaindropSettings, updateRaindropSettings } from "../../services/raindropSettingsService";
import { loadShared, peek, SETTINGS_CACHE } from "../../services/settingsPrefetch";
import { RaindropPanel } from "./RaindropPanel";

/** 插件设置节（FR-EXT-3，TP9）：默认关闭；启用才渲染 Raindrop 面板。开关不影响应用其余功能。 */
export function PluginSection({ userId }: { userId: string }) {
  const [settings, setSettings] = useState<RaindropSettings | null>(() => {
    const cached = peek<RaindropSettings | null>(SETTINGS_CACHE.raindrop(userId));
    if (cached === undefined) return null;
    return cached ? normalizeRaindropSettings(cached) : { ...DEFAULT_RAINDROP_SETTINGS };
  });

  useEffect(() => {
    let cancelled = false;
    const refresh = (fresh: boolean) => {
      void loadShared(SETTINGS_CACHE.raindrop(userId), () => readRaindropSettings(userId), fresh).then((value) => {
        // 无本地记录时服务返回 null，由调用方回退默认（关闭）。不能把 null 一直当成加载中，否则开关永远禁用。
        if (!cancelled) setSettings(value ? normalizeRaindropSettings(value) : { ...DEFAULT_RAINDROP_SETTINGS });
      });
    };
    refresh(false);
    const onChange = () => refresh(true);
    window.addEventListener("menote:raindrop-settings", onChange);
    return () => { cancelled = true; window.removeEventListener("menote:raindrop-settings", onChange); };
  }, [userId]);

  const enabled = settings?.enabled ?? false;
  return <div className="mn-settings-stack">
    <section className="mn-settings-card mn-settings-status" aria-label="Raindrop 连接器">
      <div className="mn-settings-heading">
        <div><h3>Raindrop 连接器</h3><p className="mn-sethint">定时拉取收藏到多维表格，也可预览本地改动后手动推送。</p></div>
        <label className="mn-settings-toggle"><input type="checkbox" aria-label="启用插件" checked={enabled} disabled={!settings}
          onChange={(event) => void updateRaindropSettings(userId, { enabled: event.target.checked }).then(setSettings)} />
          {settings ? enabled ? "已启用" : "已停用" : "正在读取…"}</label>
      </div>
    </section>
    {enabled && <RaindropPanel userId={userId} />}
  </div>;
}
