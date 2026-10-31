import { useEffect, useState } from "react";
import type { VersionRow } from "../../db/localDb";
import { listVersions } from "../../services/contentService";
import { restoreVersion } from "../../services/contentService";

interface HistoryPanelProps {
  userId: string;
  itemId: string;
  currentMarkdown: string;
  onClose: () => void;
}

/** 版本历史（FR-VER-1/2/4）：封存列表、行级对比、恢复（恢复前自动封存当前稿）。 */
export function HistoryPanel({ userId, itemId, currentMarkdown, onClose }: HistoryPanelProps) {
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [selected, setSelected] = useState<VersionRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listVersions(itemId).then((rows) => {
      setVersions(rows);
      setSelected(rows[0] ?? null);
    });
  }, [itemId]);

  const restore = async () => {
    if (!selected) return;
    try {
      await restoreVersion(userId, itemId, selected.id!);
      onClose();
    } catch (cause) {
      setError(String(cause));
    }
  };

  return (
    <div className="mn-overlay" role="presentation">
      <div className="mn-dialog mn-dialog-wide" role="dialog" aria-modal="true" aria-label="版本历史">
        <p className="mn-dialog-title">版本历史</p>
        {versions.length === 0 && <p className="mn-auth-hint">暂无历史版本。编辑内容会按节流自动封存。</p>}
        {versions.length > 0 && (
          <>
            <ul className="mn-versionlist" aria-label="版本列表">
              {versions.map((version) => (
                <li key={version.id}>
                  <button type="button" className={selected?.id === version.id ? "mn-versionrow on" : "mn-versionrow"}
                    onClick={() => setSelected(version)}>
                    <span>{new Date(version.createdAt).toLocaleString()}</span>
                    <span className="mn-versionmeta">rev {version.rev} · {version.reason === "restore" ? "恢复前封存" : "自动封存"}</span>
                  </button>
                </li>
              ))}
            </ul>
            {selected && <VersionDiff base={currentMarkdown} target={selected.scope === "plain" ? selected.content : "（密文，解锁后恢复）"} />}
          </>
        )}
        {error && <p className="mn-auth-error" role="alert">{error}</p>}
        <div className="mn-dialog-actions">
          <button type="button" className="mn-auth-submit" disabled={!selected} aria-disabled={!selected} onClick={() => void restore()}>
            恢复此版本
          </button>
          <button type="button" className="mn-auth-link" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

/** 行级对比（FR-VER-1）：按行对齐的简易双栏差异，够辨认改动；语义 diff 留 M3。 */
export function VersionDiff({ base, target }: { base: string; target: string }) {
  const baseLines = base.split(/\r?\n/);
  const targetLines = target.split(/\r?\n/);
  const targetSet = new Set(targetLines);
  const baseSet = new Set(baseLines);
  return (
    <div className="mn-diff" aria-label="版本对比">
      <div className="mn-diff-col">
        <p className="mn-seclabel-text">当前稿</p>
        {baseLines.map((line, index) => (
          <pre key={index} className={baseSet.has(line) && targetSet.has(line) ? "mn-diff-line" : "mn-diff-line removed"}>{line || " "}</pre>
        ))}
      </div>
      <div className="mn-diff-col">
        <p className="mn-seclabel-text">所选版本</p>
        {targetLines.map((line, index) => (
          <pre key={index} className={baseSet.has(line) && targetSet.has(line) ? "mn-diff-line" : "mn-diff-line added"}>{line || " "}</pre>
        ))}
      </div>
    </div>
  );
}

