import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { BackupPanel } from "../backup";
import { AttachmentListPanel } from "../attachments";
import { useEncryptedCount } from "../../services/contentHooks";
import { getFontPreference, setFontPreference, type FontPreference } from "../../lib/fontPreference";
import { getMeasurePreference, setMeasurePreference, type MeasurePreference } from "../../lib/measurePreference";
import { McpTokenManager } from "./McpTokenManager";
import { ClipTemplateManager } from "./ClipTemplateManager";
import { StyleSection } from "./StyleSection";
import { AiSection } from "./AiSection";
import { PluginSection } from "./PluginSection";
import { PropertyTemplatePanel } from "./PropertyTemplatePanel";
import { readAppearance, updateAppearance } from "../../services/appearanceSettingsService";

export type SettingsSection = "appearance" | "style" | "ai" | "backup" | "attachments" | "recovery" | "mcp" | "clipTemplates" | "plugins" | "propertyTemplates";

const NAV: Array<{ id: SettingsSection; label: string }> = [
  { id: "appearance", label: "外观" },
  { id: "style", label: "样式" },
  { id: "ai", label: "AI 助手" },
  { id: "backup", label: "远程备份" },
  { id: "attachments", label: "附件" },
  { id: "recovery", label: "恢复码" },
  { id: "mcp", label: "MCP 接入" },
  { id: "clipTemplates", label: "剪藏模板" },
  { id: "propertyTemplates", label: "默认属性" },
  { id: "plugins", label: "插件" },
];

interface SettingsDialogProps {
  userId: string;
  initialSection?: SettingsSection;
  onClose: () => void;
  onSectionChange?: (section: SettingsSection) => void;
}

/** 设置对话框：外观、远程备份、附件与恢复码。 */
export function SettingsDialog({ userId, initialSection = "backup", onClose, onSectionChange }: SettingsDialogProps) {
  const [section, setSection] = useState<SettingsSection>(initialSection);

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
            {NAV.map((entry) => (
              <a key={entry.id} href="#" className={section === entry.id ? "on" : ""} aria-current={section === entry.id ? "page" : undefined}
                onClick={(event) => { event.preventDefault(); setSection(entry.id); onSectionChange?.(entry.id); }}>
                {entry.label}
              </a>
            ))}
          </nav>
          <div className="mn-dlg-content">
            {section === "appearance" && <AppearanceSection userId={userId} />}
            {section === "style" && <StyleSection userId={userId} />}
            {section === "ai" && <AiSection userId={userId} />}
            {section === "backup" && <BackupPanel userId={userId} />}
            {section === "attachments" && <AttachmentListPanel userId={userId} />}
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

/** 外观节：界面字体与阅读宽度（偏好分别经 lib/fontPreference、lib/measurePreference 即时生效）。 */
function AppearanceSection({ userId }: { userId: string }) {
  const [font, setFont] = useState<FontPreference>(getFontPreference);
  const [measure, setMeasure] = useState<MeasurePreference>(getMeasurePreference);
  useEffect(() => {
    const refresh = () => { void readAppearance(userId).then((value) => {
      if (!value) return;
      if (value.font) setFont(value.font);
      if (value.measure) setMeasure(value.measure);
    }); };
    refresh();
    window.addEventListener("menote:appearance", refresh);
    return () => window.removeEventListener("menote:appearance", refresh);
  }, [userId]);
  return (
    <div>
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
          <p className="mn-sethint">窄为默认版心（约 48 汉字/行）；加宽适合代码与长表格；撑满占满文档栏。窗口不够宽时后两档会与文档栏同宽、看不出差别。表格形态不会窄于加宽档。</p>
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
