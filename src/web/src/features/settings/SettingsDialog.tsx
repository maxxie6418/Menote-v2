import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { BackupPanel } from "../backup";
import { AttachmentListPanel } from "../attachments";
import { useEncryptedCount } from "../../services/contentHooks";
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
import { getSyncPhase, requestSync, subscribeSyncStatus, syncQueueStatus, type SyncPhase } from "../../services/syncEngine";
import { subscribeLocalChanges } from "../../lib/broadcast";
import { InfoHint } from "../../components/ui/InfoHint";

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
    <div className="mn-overlay mn-settings-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
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
    <div>
      <p className="mn-setgroup">界面</p>
      <div className="mn-setrow">
        <div>
          <p className="mn-setlabel">界面主题<InfoHint>三套皮肤：素灰（默认，冷灰底 + 靛蓝强调）、墨台（暖砂底 + 朱砂）、柔纸（米黄底 + 松烟绿）。皮肤与浅色 / 深色互相独立，界面布局与编辑阅读偏好即时生效并随账号同步。</InfoHint></p>
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
          <option value="slate">素灰（默认）</option>
          <option value="ink">墨台</option>
          <option value="paper">柔纸模式</option>
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
      <p className="mn-setgroup">布局</p>
      <div className="mn-setrow">
        <div><p className="mn-setlabel">导航布局<InfoHint>完整侧栏保留主题与标签；书脊布局将其移到笔记清单顶部。窄屏仍使用抽屉。</InfoHint></p></div>
        <select className="mn-propselect" aria-label="导航布局" value={railMode} onChange={(event) => {
          const value = event.target.value as "bar" | "rail";
          setRailMode(value);
          void updateAppearance(userId, { railMode: value });
        }}><option value="bar">完整侧栏</option><option value="rail">书脊 + 清单导航</option></select>
      </div>
      <div className="mn-setrow">
        <div><p className="mn-setlabel">Memo 侧记栏位置<InfoHint>选择统计、热力图与筛选栏位于时间轴的哪一侧。</InfoHint></p></div>
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
          <p className="mn-setlabel">编辑工具栏<InfoHint>跟随主题时：柔纸模式浮动在纸面底部，其余主题固定在正文顶部（现状）。当前解析为「{resolveToolbar() === "bottom" ? "底部浮动" : "顶部固定"}」。</InfoHint></p>
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
      <section className="mn-appearance-preview" aria-label="当前外观组合预览">
        <div className="mn-appearance-preview-head"><strong>预览</strong><span>当前组合即时生效，随账号同步</span></div>
        <div className={`mn-appearance-preview-frame${railMode === "rail" ? " is-rail" : ""}${propsPos === "side" ? " has-side-props" : ""}${toolbar === "bottom" ? " has-bottom-toolbar" : ""}`} data-skin={skin} data-measure={measure} aria-hidden="true">
          <div className="mn-appearance-preview-top"><i /><i /><i /><i /></div>
          <div className="mn-appearance-preview-cols"><div className="mn-appearance-preview-nav"><i /><i /><i /><i /></div><div className="mn-appearance-preview-list"><i /><i /><i /><i /></div><div className="mn-appearance-preview-paper"><i className="is-heading" /><i /><i /><i className="is-short" /><i />{propsPos === "side" && <i className="is-props" />}</div></div>
          <div className="mn-appearance-preview-toolbar"><i /><i /><i /></div>
        </div>
        <div className="mn-appearance-preview-chips"><span>{skin === "paper" ? "柔纸模式" : skin === "ink" ? "墨台" : "素灰"}</span><span>{railMode === "rail" ? "书脊导航" : "完整侧栏"}</span><span>Memo 侧记栏{memoWorkbarSide === "left" ? "左侧" : "右侧"}</span><span>Todo 默认{memoTodoDefault === "open" ? "展开" : "收起"}</span><span>属性{propsPos === "side" ? "侧边" : "顶部"}</span><span>工具栏{toolbar === "auto" ? "跟随主题" : toolbar === "bottom" ? "底部浮动" : "顶部固定"}</span><span>{measure === "auto" ? "跟随主题版心" : measure === "narrow" ? "窄版心" : measure === "wide" ? "加宽版心" : "撑满版心"}</span></div>
      </section>
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
          <p className="mn-setlabel">恢复码<InfoHint>
            恢复码在首次启用加密时一次性展示，明文永不入库、无法事后查看；
            遗失 = 对应内容永久不可解。轮换恢复码（统一重包装全部内容密钥）将随后续版本开放。
          </InfoHint></p>
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
