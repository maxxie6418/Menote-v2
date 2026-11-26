import { useState } from "react";
import { ArchiveRestorePanel } from "../backup";
import { FlomoImportPanel, ObsidianImportPanel } from "../import";
import { useLocalDataSummary } from "../../services/contentHooks";
import { SettingsGroup } from "./SettingsGroup";

export function DataSection({ userId, onOpenAttachments, onOpenTrash }: {
  userId: string;
  onOpenAttachments: () => void;
  onOpenTrash: () => void;
}) {
  const summary = useLocalDataSummary(userId);
  const [source, setSource] = useState<"flomo" | "obsidian" | null>(null);

  return (
    <div className="mn-settings-stack">
      <SettingsGroup title="本机数据概览">
        {summary ? <dl className="mn-settings-metrics">
          <div><dt>笔记</dt><dd>{summary.note}</dd></div>
          <div><dt>随记</dt><dd>{summary.memo}</dd></div>
          <div><dt>多维表格</dt><dd>{summary.table}</dd></div>
          <div><dt>回收站</dt><dd>{summary.trash}</dd></div>
        </dl> : <p className="mn-sethint" role="status">正在读取本机数据…</p>}
      </SettingsGroup>
      <SettingsGroup title="导入与导出">
        <ArchiveRestorePanel userId={userId} />
        <div className="mn-setrow">
          <div><p className="mn-setlabel">从其他应用导入</p><p className="mn-sethint">选择来源，先在本机预览再确认导入。</p></div>
          <div className="mn-settings-segments" role="group" aria-label="导入来源">
            <button type="button" aria-pressed={source === "flomo"} onClick={() => setSource(source === "flomo" ? null : "flomo")}>Flomo</button>
            <button type="button" aria-pressed={source === "obsidian"} onClick={() => setSource(source === "obsidian" ? null : "obsidian")}>Obsidian</button>
          </div>
        </div>
        {source === "flomo" && <FlomoImportPanel userId={userId} />}
        {source === "obsidian" && <ObsidianImportPanel userId={userId} />}
      </SettingsGroup>
      <SettingsGroup title="管理与维护">
        <div className="mn-setrow">
          <div><p className="mn-setlabel">附件</p><p className="mn-sethint">查看附件引用，调整上传限制或清理可回收文件。</p></div>
          <button type="button" className="mn-textbtn mn-settings-outline" onClick={onOpenAttachments}>管理附件</button>
        </div>
        <div className="mn-setrow">
          <div><p className="mn-setlabel">回收站</p><p className="mn-sethint">查看或恢复已删除内容。</p></div>
          <button type="button" className="mn-textbtn mn-settings-outline" onClick={onOpenTrash}>打开回收站</button>
        </div>
      </SettingsGroup>
    </div>
  );
}
