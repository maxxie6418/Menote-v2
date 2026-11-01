import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { HealthResponse, Item } from "@menote/shared";
import { BackupPanel } from "../backup";
import { AttachmentListPanel } from "../attachments";
import { SyncBadge } from "../sync";
import { getSyncPhase, subscribeSyncStatus, type SyncPhase } from "../../services/syncEngine";
import { getReadiness } from "../../services/healthService";
import { useEncryptedCount } from "../../services/contentHooks";
import { APP_VERSION_FULL_LABEL } from "../../lib/version";
import { getFontPreference, setFontPreference, type FontPreference } from "../../lib/fontPreference";

type SettingsSection = "appearance" | "backup" | "attachments" | "recovery" | "status";

const NAV: Array<{ id: SettingsSection; label: string }> = [
  { id: "appearance", label: "外观" },
  { id: "backup", label: "远程备份" },
  { id: "attachments", label: "附件" },
  { id: "recovery", label: "恢复码" },
  { id: "status", label: "状态" },
];

interface SettingsDialogProps {
  userId: string;
  onClose: () => void;
  onOpenStatus: () => void;
}

/** 设置对话框（G9/G5/G7 归集；design.html：648×530 + 158px 左导航 + set-row 行式布局）。
 *  负责人 2026-11-01：状态节归集同步徽标与系统状态预览（原侧栏脚部入口迁入）。 */
export function SettingsDialog({ userId, onClose, onOpenStatus }: SettingsDialogProps) {
  const [section, setSection] = useState<SettingsSection>("backup");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="mn-overlay" role="presentation">
      <div className="mn-dialog mn-dialog-settings" role="dialog" aria-modal="true" aria-label="设置">
        <div className="mn-dlg-head">
          <h3>设置</h3>
          <button type="button" className="mn-iconbtn" aria-label="关闭设置" onClick={onClose}><X /></button>
        </div>
        <div className="mn-dlg-body">
          <nav className="mn-dlg-nav" aria-label="设置分类">
            {NAV.map((entry) => (
              <a key={entry.id} href="#" className={section === entry.id ? "on" : ""}
                onClick={(event) => { event.preventDefault(); setSection(entry.id); }}>
                {entry.label}
              </a>
            ))}
          </nav>
          <div className="mn-dlg-content">
            {section === "appearance" && <AppearanceSection />}
            {section === "backup" && <BackupPanel userId={userId} />}
            {section === "attachments" && <AttachmentListPanel userId={userId} />}
            {section === "recovery" && <RecoverySection userId={userId} />}
            {section === "status" && <StatusSection onOpenStatus={onOpenStatus} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 外观节：界面字体切换（内置 Noto Sans SC ↔ 系统字体），偏好经 lib/fontPreference 即时生效。 */
function AppearanceSection() {
  const [font, setFont] = useState<FontPreference>(getFontPreference);
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
          }}
        >
          <option value="noto">Noto Sans SC（默认）</option>
          <option value="system">系统字体</option>
        </select>
      </div>
    </div>
  );
}

/** 状态预览节（负责人 2026-11-01：同步指示与系统状态自侧栏脚部归集于此）；
 *  健康自检与资源监控的完整页走 onOpenStatus。数据一律经 services，UI 不直连网络。 */
function StatusSection({ onOpenStatus }: { onOpenStatus: () => void }) {
  const [phase, setPhase] = useState<SyncPhase>(getSyncPhase);
  const [health, setHealth] = useState<HealthResponse["status"] | "checking">("checking");
  useEffect(() => subscribeSyncStatus(() => setPhase(getSyncPhase())), []);
  useEffect(() => {
    const controller = new AbortController();
    setHealth("checking");
    getReadiness(controller.signal).then((value) => setHealth(value.status)).catch(() => {});
    return () => controller.abort();
  }, []);
  const HEALTH_TEXT = {
    checking: "正在检查配置。",
    ready: "基础配置已就绪（AUTH_PEPPER、D1、R2）。",
    alive: "基础配置尚未就绪，请检查部署配置。",
    unavailable: "基础配置尚未就绪，请检查部署配置。",
  } as const;
  return (
    <div>
      <div className="mn-setrow">
        <div>
          <p className="mn-setlabel">同步</p>
          <p className="mn-sethint">本设备内容与远端的推送/拉取状态。</p>
        </div>
        <SyncBadge />
      </div>
      <div className="mn-setrow">
        <div>
          <p className="mn-setlabel">服务健康</p>
          <p className="mn-sethint">{HEALTH_TEXT[health]}</p>
        </div>
      </div>
      <div className="mn-setrow">
        <div>
          <p className="mn-setlabel">版本</p>
          <p className="mn-sethint">{APP_VERSION_FULL_LABEL}</p>
        </div>
        <button type="button" className="mn-statuslink" onClick={onOpenStatus}>
          打开完整系统状态页
        </button>
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
