import { useState } from "react";
import { ChevronLeft } from "../../icons";
import type { Item } from "@menote/shared";
import { formatItemMeta } from "./format";
import { purgeItemsPermanently, restoreFromTrash } from "../../services/versionService";

interface TrashItemPanelProps {
  userId: string;
  item: Item;
  onBack: () => void;
  showBack: boolean;
}

/** 回收站条目面板（FR-VER-6）：恢复（清除墓碑传播）/ 永久删除（服务端硬删除）。 */
export function TrashItemPanel({ userId, item, onBack, showBack }: TrashItemPanelProps) {
  const [busy, setBusy] = useState(false);
  return (
    <article className="mn-doc" aria-label="回收站条目">
      <div className="mn-docbar">
        <span className="mn-docbar-left">
          {showBack && (
            <button type="button" className="mn-iconbtn" aria-label="返回清单" onClick={onBack}>
              <ChevronLeft />
            </button>
          )}
          <span className="mn-crumb">回收站</span>
        </span>
      </div>
      <div className="mn-docbody">
        <p className="mn-doc-title">{item.title}</p>
        <p className="mn-auth-hint">{formatItemMeta(item)} · 移入回收站于 {item.deletedAt ? new Date(item.deletedAt).toLocaleString() : "—"}</p>
        <div className="mn-dialog-actions">
          <button type="button" className="mn-auth-submit" disabled={busy} aria-disabled={busy}
            onClick={async () => { setBusy(true); await restoreFromTrash(userId, item.id); setBusy(false); onBack(); }}>
            恢复到原位置
          </button>
          <button type="button" className="mn-auth-link" disabled={busy} aria-disabled={busy}
            onClick={async () => {
              if (!window.confirm("永久删除？此操作不可恢复（加密条目的包装块一并清除）。")) return;
              setBusy(true);
              await purgeItemsPermanently(userId, [item.id]);
              setBusy(false);
              onBack();
            }}>
            永久删除
          </button>
        </div>
      </div>
    </article>
  );
}
