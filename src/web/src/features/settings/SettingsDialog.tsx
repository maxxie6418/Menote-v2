import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { BackupPanel } from "../backup";
import { AttachmentListPanel } from "../attachments";
import { useEncryptedCount } from "../../services/contentHooks";
import { getFontPreference, setFontPreference, type FontPreference } from "../../lib/fontPreference";
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
import { getSyncPhase, requestSync, subscribeSyncStatus, syncQueueStatus, type SyncPhase } from "../../services/syncEngine";
import { subscribeLocalChanges } from "../../lib/broadcast";

export type SettingsSection = "appearance" | "sync" | "style" | "ai" | "backup" | "attachments" | "syncLogs" | "recovery" | "mcp" | "clipTemplates" | "plugins" | "propertyTemplates";

const COMMON: Array<{ id: SettingsSection; label: string }> = [
  { id: "appearance", label: "外观" },
  { id: "sync", label: "同步" },
  { id: "backup", label: "备份" },
];
const CONTENT: Array<{ id: SettingsSection; label: string }> = [
  { id: "style", label: "样式" },
  { id: "propertyTemplates", label: "默认属性" },
  { id: "attachments", label: "附件" },
  { id: "recovery", label: "恢复码" },
];
const ADVANCED: Array<{ id: SettingsSection; label: string }> = [
  { id: "syncLogs", label: "同步日志" },
  { id: "ai", label: "AI 助手" },
  { id: "mcp", label: "MCP 接入" },
  { id: "clipTemplates", label: "剪藏模板" },
  { id: "plugins", label: "插件" },
];

interface SettingsDialogProps {
  userId: string;
  initialSection?: SettingsSection;
  onClose: () => void;
  onSectionChange?: (section: SettingsSection) => void;
}

/** 设置对话框：外观、远程备份、附件与恢复码。 */
export function SettingsDialog({ userId, initialSection = "appearance", onClose, onSectionChange }: SettingsDialogProps) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [advancedOpen, setAdvancedOpen] = useState(ADVANCED.some((entry) => entry.id === initialSection));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="mn-overlay mn-settings-overlay" role="presentation">
      <div className="mn-dialog mn-dialog-settings" role="dialog" aria-modal="true" aria-label="设置">
        <div className="mn-dlg-head">
          <h3>设置</h3>
          <button type="button" className="mn-iconbtn" aria-label="关闭设置" onClick={onClose}><X /></button>
        </div>
        <div className="mn-dlg-body">
          <nav className="mn-dlg-nav" aria-label="设置分类">
            <p className="mn-nav-label">常用</p>
            {COMMON.map((entry) => (
              <a key={entry.id} href="#" className={section === entry.id ? "on" : ""} aria-current={section === entry.id ? "page" : undefined}
                onClick={(event) => { event.preventDefault(); setSection(entry.id); onSectionChange?.(entry.id); }}>
                {entry.label}
              </a>
            ))}
            <p className="mn-nav-label">内容</p>
            {CONTENT.map((entry) => (
              <a key={entry.id} href="#" className={section === entry.id ? "on" : ""} aria-current={section === entry.id ? "page" : undefined}
                onClick={(event) => { event.preventDefault(); setSection(entry.id); onSectionChange?.(entry.id); }}>
                {entry.label}
              </a>
            ))}
            <p className="mn-nav-label"><button type="button" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((open) => !open)}>{advancedOpen ? "高级" : "高级 · 连接器与诊断"}</button></p>
            {advancedOpen && ADVANCED.map((entry) => (
              <a key={entry.id} href="#" className={section === entry.id ? "on" : ""} aria-current={section === entry.id ? "page" : undefined}
                onClick={(event) => { event.preventDefault(); setSection(entry.id); onSectionChange?.(entry.id); }}>
                {entry.label}
              </a>
            ))}
          </nav>
          <div className="mn-dlg-content">
            {section === "appearance" && <AppearanceSection userId={userId} />}
            {section === "sync" && <SyncSection userId={userId} onOpenLogs={() => { setAdvancedOpen(true); setSection("syncLogs"); onSectionChange?.("syncLogs"); }} />}
            {section === "style" && <StyleSection userId={userId} />}
            {section === "ai" && <AiSection userId={userId} />}
            {section === "backup" && <BackupPanel userId={userId} />}
            {section === "attachments" && <AttachmentListPanel userId={userId} />}
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
  );
}

function SyncSection({ userId, onOpenLogs }: { userId: string; onOpenLogs: () => void }) {
  const [phase, setPhase] = useState<SyncPhase>(getSyncPhase);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);
  useEffect(() => subscribeSyncStatus(() => setPhase(getSyncPhase())), []);
  useEffect(() => {
    const load = () => { void syncQueueStatus(userId).then((status) => { setPending(status.pending); setFailed(status.failed); }); };
    load();
    return subscribeLocalChanges(load);
  }, [userId]);
  const label = phase === "syncing" ? "正在同步" : phase === "error" || failed > 0 ? "同步失败" : pending > 0 ? "已保存，等待上传" : "已同步";
  return (
    <section className="mn-settings-section" aria-label="同步">
      <p>{label}{pending > 0 ? ` · ${pending} 项待上传` : ""}</p>
      {(phase === "error" || failed > 0) && <button type="button" className="mn-btn" onClick={() => void requestSync(userId)}>重试同步</button>}
      <button type="button" className="mn-textbtn" onClick={onOpenLogs}>查看诊断日志</button>
    </section>
  );
}

/** 外观节：界面主题、字体、阅读宽度、属性位置与工具栏位置。
 *  偏好分别经 lib/themeSkin、lib/fontPreference、lib/measurePreference、lib/docLayout 即时生效。 */
function AppearanceSection({ userId }: { userId: string }) {
  const [skin, setSkin] = useState<ThemeSkin>(getThemeSkin);
  const [font, setFont] = useState<FontPreference>(getFontPreference);
  const [measure, setMeasure] = useState<MeasurePreference>(getMeasurePreference);
  const [propsPos, setPropsPos] = useState<PropsPlacement>(getPropsPlacement);
  const [toolbar, setToolbar] = useState<ToolbarPlacement>(getToolbarPlacement);
  useEffect(() => {
    const refresh = () => { void readAppearance(userId).then((value) => {
      if (!value) return;
      if (value.skin) setSkin(value.skin);
      if (value.font) setFont(value.font);
      if (value.measure) setMeasure(value.measure);
      if (value.propsPos) setPropsPos(value.propsPos);
      if (value.toolbar) setToolbar(value.toolbar);
    }); };
    refresh();
    window.addEventListener("menote:appearance", refresh);
    return () => window.removeEventListener("menote:appearance", refresh);
  }, [userId]);
  return (
    <div>
      <div className="mn-setrow">
        <div>
          <p className="mn-setlabel">界面主题</p>
          <p className="mn-sethint">默认沿用现有纸白界面；柔纸模式换成四层暖色纸面（侧栏 / 清单 / 纸面 / 案头）、宋体标题与更窄的版心，与深色 / 浅色互相独立。</p>
        </div>
        <select
          className="mn-propselect"
          aria-label="界面主题"
          value={skin}
          onChange={(event) => {
            const value = event.target.value as ThemeSkin;
            setThemeSkin(value);
            setSkin(value);
            void updateAppearance(userId, { skin: value });
          }}
        >
          <option value="default">默认</option>
          <option value="paper">柔纸模式</option>
        </select>
      </div>
      <div className="mn-setrow">
        <div>
          <p className="mn-setlabel">属性显示位置</p>
          <p className="mn-sethint">顶部：属性在标题与正文之间（项目现状）。侧边：属性移到纸面右侧页边注，窄窗口或移动端会自动落回顶部。</p>
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
          <p className="mn-setlabel">编辑工具栏</p>
          <p className="mn-sethint">跟随主题时：柔纸模式浮动在纸面底部，其余主题固定在正文顶部（现状）。当前解析为「{resolveToolbar() === "bottom" ? "底部浮动" : "顶部固定"}」。</p>
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
      <div className="mn-setrow">
        <div>
          <p className="mn-setlabel">界面字体</p>
          <p className="mn-sethint">默认使用内置的 Noto Sans SC（随应用分发，无需联网加载）；切换为系统字体后由设备决定渲染。</p>
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
        <div>
          <p className="mn-setlabel">阅读宽度</p>
          <p className="mn-sethint">窄为默认版心（约 48 汉字/行）；加宽适合代码与长表格；撑满占满文档栏。柔纸模式固定使用更窄的纸面版心，此设置只影响其他主题。</p>
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
          <option value="narrow">窄（默认）</option>
          <option value="wide">加宽</option>
          <option value="full">撑满</option>
        </select>
      </div>
    </div>
  );
}

/** 恢复码说明区（FR-ENC-6：明文仅启用时展示一次；轮换 UI 随 G7 遗留排期）。 */
function RecoverySection({ userId }: { userId: string }) {
  const encryptedCount = useEncryptedCount(userId);
  return (
    <div>
      <div className="mn-setrow">
        <div>
          <p className="mn-setlabel">恢复码</p>
          <p className="mn-sethint">
            恢复码在首次启用加密时一次性展示，明文永不入库、无法事后查看；
            遗失 = 对应内容永久不可解。轮换恢复码（统一重包装全部内容密钥）将随后续版本开放。
          </p>
        </div>
      </div>
      <div className="mn-setrow">
        <div>
          <p className="mn-setlabel">已启用加密的条目</p>
          <p className="mn-sethint">{encryptedCount ?? "…"} 篇（单篇加密与私人空间共用同一恢复码体系）</p>
        </div>
      </div>
    </div>
  );
}
