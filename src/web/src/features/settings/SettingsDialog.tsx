import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Item } from "@menote/shared";
import { BackupPanel } from "../backup";
import { AttachmentListPanel } from "../attachments";
import { useEncryptedCount } from "../../services/contentHooks";

type SettingsSection = "backup" | "attachments" | "recovery";

const NAV: Array<{ id: SettingsSection; label: string }> = [
  { id: "backup", label: "远程备份" },
  { id: "attachments", label: "附件" },
  { id: "recovery", label: "恢复码" },
];

interface SettingsDialogProps {
  userId: string;
  onClose: () => void;
}

/** 设置对话框（G9/G5/G7 归集；design.html：648×530 + 158px 左导航 + set-row 行式布局）。 */
export function SettingsDialog({ userId, onClose }: SettingsDialogProps) {
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
            {section === "backup" && <BackupPanel userId={userId} />}
            {section === "attachments" && <AttachmentListPanel userId={userId} />}
            {section === "recovery" && <RecoverySection userId={userId} />}
          </div>
        </div>
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
