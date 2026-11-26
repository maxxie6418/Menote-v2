import { readAiAvailability } from "../../services/aiService";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, RefreshCw, X } from "../../icons";
import { BackupPanel } from "../backup";
import { AttachmentListPanel } from "../attachments";
import { useEncryptedCount } from "../../services/contentHooks";
import { findPrivateSpace, privateSpaceReady } from "../../services/privateSpaceService";
import { getFontPreference, setFontPreference, type FontPreference } from "../../lib/fontPreference";
import { getDensityPreference, setDensityPreference, type DensityPreference } from "../../lib/density";
import { getMeasurePreference, setMeasurePreference, type MeasurePreference } from "../../lib/measurePreference";
import { getThemeSkin, setThemeSkin, type ThemeSkin } from "../../lib/themeSkin";
import { getPropsPlacement, getToolbarPlacement, resolveToolbar, setPropsPlacement, setToolbarPlacement, type PropsPlacement, type ToolbarPlacement } from "../../lib/docLayout";
import { McpTokenManager } from "./McpTokenManager";
import { ClipTemplateManager } from "./ClipTemplateManager";
import { StyleSection } from "./StyleSection";
import { AiSection } from "./AiSection";
import { PluginSection } from "./PluginSection";
import { PropertyTemplatePanel } from "./PropertyTemplatePanel";
import { readAppearance, updateAppearance } from "../../services/appearanceSettingsService";
import { SyncLogSection } from "./SyncLogSection";
import { AttachmentPolicySettings } from "./AttachmentPolicySettings";
import { RecoveryCodeSettings } from "./RecoveryCodeSettings";
import { getDeviceId, getSyncPhase, getSyncProgress, requestSyncNow, subscribeSyncStatus, syncQueueStatus, type SyncPhase, type SyncProgress } from "../../services/syncEngine";
import { lastSyncCycleSummary, subscribeSyncDiagnostics } from "../../services/syncDiagnosticsService";
import { subscribeLocalChanges } from "../../lib/broadcast";
import { InfoHint } from "../../components/ui/InfoHint";
import { SettingsGroup } from "./SettingsGroup";

export type SettingsSection = "appearance" | "sync" | "style" | "ai" | "backup" | "attachments" | "syncLogs" | "recovery" | "mcp" | "clipTemplates" | "plugins" | "propertyTemplates";

const NAV_GROUPS = [
  { label: "常用", entries: [{ id: "appearance", label: "外观" }, { id: "sync", label: "同步" }, { id: "backup", label: "备份与恢复" }] },
  { label: "内容", entries: [{ id: "style", label: "样式" }, { id: "propertyTemplates", label: "默认属性" }, { id: "attachments", label: "附件" }, { id: "recovery", label: "恢复码" }] },
  { label: "高级", entries: [{ id: "syncLogs", label: "同步日志" }, { id: "ai", label: "AI 助手" }, { id: "mcp", label: "MCP 接入" }, { id: "clipTemplates", label: "剪藏模板" }, { id: "plugins", label: "插件" }] },
] as const;
const SECTION_LABELS = Object.fromEntries(NAV_GROUPS.flatMap(group => group.entries.map(entry => [entry.id, entry.label])));

interface SettingsDialogProps {
  userId: string;
  section: SettingsSection;
  onClose: () => void;
  onSectionChange: (section: SettingsSection) => void;
}

/** 设置对话框：外观、远程备份、附件与恢复码。 */
export function SettingsDialog({ userId, section, onClose, onSectionChange }: SettingsDialogProps) {
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const nav = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    void readAiAvailability(controller.signal).then(value => { if (!controller.signal.aborted) setAiAvailable(value); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [section, aiAvailable]);
  useEffect(() => {
    if (content.current) content.current.scrollTop = 0;
    if (document.activeElement === document.body) content.current?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  }, [section]);
  useEffect(() => {
    nav.current?.querySelector<HTMLAnchorElement>('[aria-current="page"]')?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented && !document.getElementById("mn-confirm-title")) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="mn-overlay mn-settings-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="mn-dialog mn-dialog-settings" role="dialog" aria-modal="true" aria-label="设置">
        <div className="mn-dlg-head">
          <h3>设置</h3>
          <button type="button" className="mn-iconbtn" aria-label="关闭设置" onClick={onClose}><X /></button>
        </div>
        <div className="mn-dlg-body">
          <nav className="mn-dlg-nav" aria-label="设置分类" ref={nav}>
            {NAV_GROUPS.map(group => (
              <div className="mn-settings-nav-group" key={group.label}>
                <p className="mn-nav-label">{group.label}</p>
                {group.entries.filter(entry => entry.id !== "ai" || aiAvailable).map(entry => (
                  <a key={entry.id} href={`/settings/${entry.id}`}
                    aria-current={section === entry.id ? "page" : undefined}
                    onClick={event => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                      event.preventDefault();
                      if (entry.id !== section) onSectionChange(entry.id);
                    }}>{entry.label}</a>
                ))}
              </div>
            ))}
          </nav>
          <div className="mn-dlg-content" ref={content}>
            <div className="mn-settings-page" key={section}>
              {section !== "backup" && <h2 className="mn-settings-page-title" tabIndex={-1}>{SECTION_LABELS[section]}</h2>}
              {section === "appearance" && <AppearanceSection userId={userId} />}
              {section === "sync" && <SyncSection userId={userId} onOpenLogs={() => onSectionChange("syncLogs")} />}
              {section === "style" && <StyleSection userId={userId} />}
              {section === "ai" && (aiAvailable ? <AiSection userId={userId} /> : <p className="mn-settings-empty" role="status">{aiAvailable === null ? "正在检查可用性…" : "此实例尚未配置 AI 助手。"}</p>)}
              {section === "backup" && <BackupPanel userId={userId} />}
              {section === "attachments" && <><AttachmentPolicySettings userId={userId} /><AttachmentListPanel userId={userId} /></>}
              {section === "syncLogs" && <SyncLogSection userId={userId} />}
              {section === "recovery" && <RecoverySection userId={userId} />}
              {section === "mcp" && <McpTokenManager />}
              {section === "clipTemplates" && <ClipTemplateManager />}
              {section === "propertyTemplates" && <PropertyTemplatePanel userId={userId} />}
              {section === "plugins" && <PluginSection userId={userId} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 同步设置页：在侧栏状态之外补齐必要信息——上次同步时间、队列明细、失败原因、设备与自动同步机制。
 *  数据口径：队列与设备号来自 syncEngine；上次同步与最近错误来自本机诊断日志（syncDiagnosticsService）。 */
function SyncSection({ userId, onOpenLogs }: { userId: string; onOpenLogs: () => void }) {
  const [phase, setPhase] = useState<SyncPhase>(getSyncPhase);
  const [progress, setProgress] = useState<SyncProgress>(getSyncProgress);
  const [queue, setQueue] = useState({ pending: 0, failed: 0 });
  const [summary, setSummary] = useState<{ completedAt: number | null; lastError: { at: number; code: string } | null } | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => subscribeSyncStatus(() => { setPhase(getSyncPhase()); setProgress(getSyncProgress()); }), []);
  const loadQueue = useCallback(() => { void syncQueueStatus(userId).then(setQueue); }, [userId]);
  const loadSummary = useCallback(() => { void lastSyncCycleSummary(userId).then(setSummary); }, [userId]);
  useEffect(() => {
    loadQueue();
    return subscribeLocalChanges(loadQueue);
  }, [loadQueue]);
  useEffect(() => {
    loadSummary();
    void getDeviceId().then((id) => setDeviceId(id));
    return subscribeSyncDiagnostics(loadSummary);
  }, [loadSummary]);
  const statusText = phase === "syncing"
    ? (progress.stage === "push" && progress.total > 0 ? `正在上传 ${progress.completed}/${progress.total}` : progress.stage === "pull" ? "正在拉取更新…" : "同步中…")
    : phase === "error" ? "同步异常" : queue.failed > 0 ? `同步异常 · ${queue.failed} 项失败` : queue.pending > 0 ? `已保存，${queue.pending} 项待上传` : "已同步";
  const errorText = summary?.lastError
    ? `${new Date(summary.lastError.at).toLocaleString()} · ${summary.lastError.code}`
    : "最近没有记录到错误";
  const syncNow = async () => {
    setBusy(true);
    try { await requestSyncNow(userId); }
    finally { loadQueue(); loadSummary(); setBusy(false); }
  };
  return (
    <div className="mn-settings-stack">
      <section className="mn-settings-card mn-settings-status" aria-label="同步状态">
        <div className="mn-settings-heading">
          <div><h3>当前状态</h3><p className="mn-settings-state" data-error={phase === "error" || queue.failed > 0} role="status">{statusText}</p></div>
          <button type="button" className="mn-textbtn mn-settings-primary" disabled={busy || phase === "syncing"} onClick={() => void syncNow()}>
            <RefreshCw />{busy ? "同步中…" : "立即同步"}
          </button>
        </div>
        <dl className="mn-settings-metrics">
          <div><dt>待上传</dt><dd>{queue.pending} 项</dd></div>
          <div><dt>失败</dt><dd>{queue.failed} 项</dd></div>
          <div><dt>上次同步完成</dt><dd>{summary === null ? "读取中…" : summary.completedAt ? new Date(summary.completedAt).toLocaleString() : "等待首轮同步"}</dd></div>
        </dl>
        {(phase === "error" || queue.failed > 0) && <p className="mn-settings-notice is-error">{errorText}</p>}
        <div className="mn-set-actions"><button type="button" className="mn-textbtn mn-settings-outline" onClick={onOpenLogs}>查看诊断日志</button></div>
      </section>
      <details className="mn-settings-fold">
        <summary>自动同步与设备信息 <ChevronDown /></summary>
        <div className="mn-settings-fold-body">
          <p className="mn-sethint">本地保存后即排队上传。联网时每 5 分钟同步一次，回到前台也会同步。离线改动在恢复联网后续传。</p>
          <p className="mn-sethint">本设备标识 <code className="mn-syncvalue">{deviceId ? deviceId.slice(0, 12) : "读取中…"}</code></p>
        </div>
      </details>
    </div>
  );
}

/** 外观节：界面主题、字体、阅读宽度、属性位置与工具栏位置。
 *  偏好分别经 lib/themeSkin、lib/fontPreference、lib/measurePreference、lib/docLayout 即时生效。 */
function AppearanceSection({ userId }: { userId: string }) {
  const [skin, setSkin] = useState<ThemeSkin>(getThemeSkin);
  const [font, setFont] = useState<FontPreference>(getFontPreference);
  const [density, setDensity] = useState<DensityPreference>(getDensityPreference);
  const [measure, setMeasure] = useState<MeasurePreference>(getMeasurePreference);
  const [propsPos, setPropsPos] = useState<PropsPlacement>(getPropsPlacement);
  const [toolbar, setToolbar] = useState<ToolbarPlacement>(getToolbarPlacement);
  const [railMode, setRailMode] = useState<"bar" | "rail">(() => document.documentElement.dataset.rail === "rail" ? "rail" : "bar");
  const [memoWorkbarSide, setMemoWorkbarSide] = useState<"left" | "right">(() => document.documentElement.dataset.memoWorkbarSide === "right" ? "right" : "left");
  const [memoTodoDefault, setMemoTodoDefault] = useState<"open" | "closed">(() => document.documentElement.dataset.memoTodoDefault === "closed" ? "closed" : "open");
  useEffect(() => {
    const refresh = () => { void readAppearance(userId).then((value) => {
      if (!value) return;
      if (value.skin) setSkin(value.skin);
      if (value.font) setFont(value.font);
      if (value.density) setDensity(value.density);
      if (value.measure) setMeasure(value.measure);
      if (value.propsPos) setPropsPos(value.propsPos);
      if (value.toolbar) setToolbar(value.toolbar);
      setRailMode(value.railMode ?? "bar");
      setMemoWorkbarSide(value.memoWorkbarSide ?? "left");
      setMemoTodoDefault(value.memoTodoDefault ?? "open");
    }); };
    refresh();
    window.addEventListener("menote:appearance", refresh);
    return () => window.removeEventListener("menote:appearance", refresh);
  }, [userId]);
  return (
    <div className="mn-settings-stack">
      <SettingsGroup title="界面">
        <div className="mn-setrow">
          <div>
            <p className="mn-setlabel">界面主题<InfoHint>皮肤与浅色、深色模式可独立选择。外观偏好即时生效并随账号同步。</InfoHint></p>
          </div>
            <select className="mn-propselect" aria-label="界面主题" value={skin} onChange={(event) => {
              const value = event.target.value as ThemeSkin;
              setThemeSkin(value); setSkin(value); void updateAppearance(userId, { skin: value });
            }}>
              <option value="shadcn">shadcn/ui（默认）</option><option value="slate">素灰</option><option value="ink">墨台</option>
            </select>
        </div>
        <div className="mn-setrow">
          <div>
            <p className="mn-setlabel">界面密度<InfoHint>整站按比例缩放：字号、间距、按钮与图标一起变，不是单独放大字号。高分屏觉得字小选「舒适」或「宽松」；窄屏想多放内容选「紧凑」。</InfoHint></p>
          </div>
          <select
            className="mn-propselect"
            aria-label="界面密度"
            value={density}
            onChange={(event) => {
              const value = event.target.value as DensityPreference;
              setDensityPreference(value);
              setDensity(value);
              void updateAppearance(userId, { density: value });
            }}
          >
            <option value="compact">紧凑（15px 基准）</option>
            <option value="standard">标准（16px 基准）</option>
            <option value="cozy">舒适（17px 基准）</option>
            <option value="spacious">宽松（18px 基准）</option>
          </select>
        </div>
        <div className="mn-setrow">
          <div>
            <p className="mn-setlabel">界面字体<InfoHint>默认使用内置的 Noto Sans SC（随应用分发，无需联网加载）；切换为系统字体后由设备决定渲染。</InfoHint></p>
          </div>
          <select
            className="mn-propselect"
            aria-label="界面字体"
            value={font}
            onChange={(event) => {
              const value = event.target.value as FontPreference;
              setFontPreference(value);
              setFont(value);
              void updateAppearance(userId, { font: value });
            }}
          >
            <option value="noto">Noto Sans SC（默认）</option>
            <option value="system">系统字体</option>
          </select>
        </div>
        <div className="mn-setrow">
          <div><p className="mn-setlabel">导航布局<InfoHint>完整侧栏显示主题与标签。书脊布局在笔记清单顶部显示主题与标签。窄屏使用抽屉。</InfoHint></p></div>
          <select className="mn-propselect" aria-label="导航布局" value={railMode} onChange={(event) => {
            const value = event.target.value as "bar" | "rail";
            setRailMode(value);
            void updateAppearance(userId, { railMode: value });
          }}><option value="bar">完整侧栏</option><option value="rail">书脊 + 清单导航</option></select>
        </div>
      </SettingsGroup>
      <SettingsGroup title="笔记">
        <div className="mn-setrow">
          <div>
            <p className="mn-setlabel">阅读宽度<InfoHint>跟随主题默认宽度；也可选窄、加宽或撑满，所选宽度在所有主题生效并覆盖主题默认值。</InfoHint></p>
          </div>
          <select
            className="mn-propselect"
            aria-label="阅读宽度"
            value={measure}
            onChange={(event) => {
              const value = event.target.value as MeasurePreference;
              setMeasurePreference(value);
              setMeasure(value);
              void updateAppearance(userId, { measure: value });
            }}
          >
            <option value="auto">跟随主题默认</option>
            <option value="narrow">窄</option>
            <option value="wide">加宽</option>
            <option value="full">撑满</option>
          </select>
        </div>
        <div className="mn-setrow">
          <div>
            <p className="mn-setlabel">属性显示位置<InfoHint>顶部：属性在标题与正文之间（项目现状）。侧边：属性移到纸面右侧页边注，窄窗口或移动端会自动落回顶部。</InfoHint></p>
          </div>
          <select
            className="mn-propselect"
            aria-label="属性显示位置"
            value={propsPos}
            onChange={(event) => {
              const value = event.target.value as PropsPlacement;
              setPropsPlacement(value);
              setPropsPos(value);
              void updateAppearance(userId, { propsPos: value });
            }}
          >
            <option value="top">顶部（标题下方）</option>
            <option value="side">侧边（页边注）</option>
          </select>
        </div>
        <div className="mn-setrow">
          <div>
            <p className="mn-setlabel">编辑工具栏<InfoHint>当前显示为「{resolveToolbar() === "bottom" ? "底部浮动" : "顶部固定"}」。</InfoHint></p>
          </div>
          <select
            className="mn-propselect"
            aria-label="编辑工具栏"
            value={toolbar}
            onChange={(event) => {
              const value = event.target.value as ToolbarPlacement;
              setToolbarPlacement(value);
              setToolbar(value);
              void updateAppearance(userId, { toolbar: value });
            }}
          >
            <option value="auto">跟随主题</option>
            <option value="top">顶部固定</option>
            <option value="bottom">底部浮动</option>
          </select>
        </div>
      </SettingsGroup>
      <SettingsGroup title="Memo">
        <div className="mn-setrow">
          <div><p className="mn-setlabel">Memo 侧记栏位置<InfoHint>选择侧记栏位于时间轴的哪一侧。</InfoHint></p></div>
          <select className="mn-propselect" aria-label="Memo 侧记栏位置" value={memoWorkbarSide} onChange={(event) => {
            const value = event.target.value as "left" | "right";
            setMemoWorkbarSide(value);
            void updateAppearance(userId, { memoWorkbarSide: value });
          }}><option value="left">左侧</option><option value="right">右侧</option></select>
        </div>
        <div className="mn-setrow">
          <div><p className="mn-setlabel">Memo Todo 默认状态<InfoHint>控制进入 Memo 时 Todo 侧板默认展开或收起；之后仍可在页面中切换。</InfoHint></p></div>
          <select className="mn-propselect" aria-label="Memo Todo 默认状态" value={memoTodoDefault} onChange={(event) => {
            const value = event.target.value as "open" | "closed";
            setMemoTodoDefault(value);
            void updateAppearance(userId, { memoTodoDefault: value });
          }}><option value="open">展开</option><option value="closed">收起</option></select>
        </div>
      </SettingsGroup>
      <details className="mn-settings-fold">
        <summary>预览布局 <ChevronDown /></summary>
        <div className="mn-settings-fold-body">
          <div className={`mn-appearance-preview-frame${railMode === "rail" ? " is-rail" : ""}${propsPos === "side" ? " has-side-props" : ""}${toolbar === "bottom" ? " has-bottom-toolbar" : ""}`} data-skin={skin} data-measure={measure} aria-hidden="true">
            <div className="mn-appearance-preview-top"><i /><i /><i /><i /></div>
            <div className="mn-appearance-preview-cols"><div className="mn-appearance-preview-nav"><i /><i /><i /><i /></div><div className="mn-appearance-preview-list"><i /><i /><i /><i /></div><div className="mn-appearance-preview-paper"><i className="is-heading" /><i /><i /><i className="is-short" /><i />{propsPos === "side" && <i className="is-props" />}</div></div>
            <div className="mn-appearance-preview-toolbar"><i /><i /><i /></div>
          </div>
        </div>
      </details>
    </div>
  );
}

/** 恢复码说明区（FR-ENC-6：明文仅启用时展示一次；轮换 UI 随 G7 遗留排期）。 */
function RecoverySection({ userId }: { userId: string }) {
  const encryptedCount = useEncryptedCount(userId);
  const [memoAccessGate, setMemoAccessGate] = useState(false);
  const [spaceReady, setSpaceReady] = useState(false);
  const [gateLoading, setGateLoading] = useState(true);
  const [gateSaving, setGateSaving] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const appearance = await readAppearance(userId);
        const space = await findPrivateSpace(userId);
        const ready = space ? await privateSpaceReady(space.id) : false;
        if (cancelled) return;
        setMemoAccessGate(appearance?.memoAccessGate === true);
        setSpaceReady(ready);
        setGateError(null);
      } catch {
        if (!cancelled) setGateError("无法读取 Memo 入口保护设置。");
      } finally {
        if (!cancelled) setGateLoading(false);
      }
    };
    void refresh();
    window.addEventListener("menote:appearance", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("menote:appearance", refresh);
    };
  }, [userId]);

  const changeMemoAccessGate = async (enabled: boolean) => {
    if (enabled && !spaceReady) return;
    setGateSaving(true);
    setGateError(null);
    const previous = memoAccessGate;
    setMemoAccessGate(enabled);
    try {
      await updateAppearance(userId, { memoAccessGate: enabled });
    } catch {
      setMemoAccessGate(previous);
      setGateError("保存失败，请重试。");
    } finally {
      setGateSaving(false);
    }
  };

  return (
    <div className="mn-settings-stack">
      <RecoveryCodeSettings key={userId} userId={userId} encryptedCount={encryptedCount} />
      <SettingsGroup title="Memo 入口">
        <div className="mn-setrow">
          <div>
            <p className="mn-setlabel">Memo 入口口令保护<InfoHint>每次进入 Memo 页面前验证私人空间密码。此设置只拦截前端入口，不加密 Memo 正文或附件。</InfoHint></p>
            <p className="mn-sethint">{spaceReady ? "Memo 正文与附件仍按普通内容明文存储和同步。" : memoAccessGate ? "本机暂缺私人空间密码包装；同步私人空间后可验证，也可在此关闭保护。" : "需先设置私人空间密码，才能启用此入口保护。"}</p>
          </div>
          <select
            className="mn-propselect"
            aria-label="Memo 入口口令保护"
            value={memoAccessGate ? "on" : "off"}
            disabled={gateLoading || gateSaving || (!spaceReady && !memoAccessGate)}
            onChange={(event) => void changeMemoAccessGate(event.target.value === "on")}
          >
            <option value="off">关闭</option>
            <option value="on">使用私人空间密码</option>
          </select>
        </div>
        {gateError && <p className="mn-auth-error" role="alert">{gateError}</p>}
      </SettingsGroup>
    </div>
  );
}
