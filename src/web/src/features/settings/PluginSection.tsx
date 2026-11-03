import { useEffect, useState } from "react";
import { DEFAULT_RAINDROP_SETTINGS, normalizeRaindropSettings, type RaindropSettings } from "@menote/shared";
import { readRaindropSettings, updateRaindropSettings } from "../../services/raindropSettingsService";
import { RaindropPanel } from "./RaindropPanel";

/** 插件设置节（FR-EXT-3，TP9）：默认关闭；启用才渲染 Raindrop 面板。开关不影响应用其余功能。 */
export function PluginSection({ userId }: { userId: string }) {
  const [settings, setSettings] = useState<RaindropSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void readRaindropSettings(userId).then((value) => {
        // 无本地记录时服务返回 null，由调用方回退默认（关闭）。不能把 null 一直当成加载中，否则开关永远禁用。
        if (!cancelled) setSettings(value ? normalizeRaindropSettings(value) : { ...DEFAULT_RAINDROP_SETTINGS });
      });
    };
    refresh();
    window.addEventListener("menote:raindrop-settings", refresh);
    return () => { cancelled = true; window.removeEventListener("menote:raindrop-settings", refresh); };
  }, [userId]);

  const enabled = settings?.enabled ?? false;

  return (
    <div>
      <div className="mn-setrow">
        <div>
          <p className="mn-setlabel">启用插件</p>
          <p className="mn-sethint">
            首个内置插件为 Raindrop 连接器：把指定表格作为网页收藏中间件，自动定时拉取远端收藏，
            并支持手动预览确认后反推远端作为云端备份。关闭后设置页隐藏、定时拉取跳过，应用其余功能不受影响。
          </p>
        </div>
        <input type="checkbox" aria-label="启用插件" checked={enabled} disabled={!settings}
          onChange={(event) => void updateRaindropSettings(userId, { enabled: event.target.checked }).then(setSettings)} />
      </div>
      {!settings
        ? <p className="mn-sethint">设置加载中…</p>
        : enabled ? <RaindropPanel /> : null}
    </div>
  );
}
