import { useState } from "react";
import type { MemoryBindPreview, MemoryPluginStatus } from "@menote/shared";
import { InfoHint } from "../../components/ui/InfoHint";
import { itemRoutePath } from "../../app/appRoutes";
import { useHomeSnapshot } from "../../services/contentHooks";
import { bindMemoryTable, createMemoryTable, previewMemoryTable, unbindMemoryTable } from "../../services/memoryService";
import { formatMemoryConnectionPrompt } from "./memoryConnectionPrompt";
import { SettingsGroup } from "./SettingsGroup";

const issues: Record<string, string> = {
  invalid_table: "检查空列名或重复列名",
  invalid_fields: "修正字段定义",
  invalid_field_type: "字段类型不符",
  invalid_field_options: "单选选项不符",
  invalid_scope: "请选择 personal 或 project",
  invalid_project: "检查项目标识",
  invalid_key: "检查记忆键",
  invalid_status: "请选择 active 或 archived",
  invalid_text: "内容缺失或超长",
  key_exists: "记忆键重复",
  invalid_row_id: "行 ID 无效或重复",
  invalid_row_version: "行版本无效",
};

export function MemoryPluginPanel({ userId, status, onChange }: {
  userId: string; status: MemoryPluginStatus; onChange: (status: MemoryPluginStatus) => void;
}) {
  const snapshot = useHomeSnapshot(userId);
  const [tableId, setTableId] = useState("");
  const [preview, setPreview] = useState<MemoryBindPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copyFeedback, setCopyFeedback] = useState("");
  const binding = status.binding;
  const privateIds = new Set(snapshot.topics.filter((topic) => topic.isEncSpace).map((topic) => topic.id));
  const tables = snapshot.items.filter((item) => item.type === "table" && item.deletedAt === null && item.content.scope === "plain"
    && !privateIds.has(item.topicId ?? "") && !privateIds.has(item.groupId ?? ""));

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try { await action(); }
    catch (error) { setError(error instanceof Error ? error.message : "请求失败，请重试。"); }
    finally { setBusy(false); }
  }

  async function copyPrompt() {
    try {
      const endpoint = `${window.location.origin}/api/mcp`;
      await navigator.clipboard.writeText(formatMemoryConnectionPrompt(endpoint));
      setCopyFeedback("已复制提示词，可与 MCP Token 一起发送给 AI。");
    } catch {
      setCopyFeedback("复制失败，请检查浏览器剪贴板权限。");
    }
  }

  return <div className="mn-settings-stack">
    {error && <p className="mn-settings-notice is-error" role="alert">{error}</p>}
    <SettingsGroup title="记忆表">
      {binding ? <div className="mn-setrow">
        <div><p className="mn-setlabel">{binding.title}</p>{binding.topicName && <p className="mn-sethint">{binding.topicName}</p>}</div>
        {binding.problem !== "memory_unavailable" && <a className="mn-statuslink" href={itemRoutePath(binding.tableId)}>打开表格</a>}
        <button type="button" className="mn-statuslink" disabled={busy} onClick={() => void run(async () => {
          onChange(await unbindMemoryTable(binding.id)); setPreview(null);
        })}>解除绑定</button>
      </div> : <div className="mn-setrow">
        <button type="button" className="mn-textbtn mn-settings-primary" disabled={busy} onClick={() => void run(async () => {
          onChange(await createMemoryTable(userId)); setPreview(null);
        })}>新建记忆表</button>
      </div>}
      {binding && !binding.available && <p className="mn-settings-notice is-error" role="alert">
        {binding.problem === "memory_unavailable" ? "绑定表格已不可访问。" : "表格结构需要修复。"}
      </p>}
      <div className="mn-setrow">
        <div><p className="mn-setlabel">{binding ? "更换绑定表格" : "绑定已有表格"}<InfoHint>绑定前校验记录，确认后补齐记忆字段。自定义列保留。</InfoHint></p></div>
        <select className="mn-propselect" aria-label="绑定已有表格" value={tableId} disabled={!tables.length || busy} onChange={(event) => {
          setTableId(event.target.value); setPreview(null); setError("");
        }}>
          <option value="">{tables.length ? "选择表格" : "暂无可绑定表格"}</option>
          {tables.map((table) => <option key={table.id} value={table.id}>{table.title || "无标题"}</option>)}
        </select>
        <button type="button" className="mn-textbtn mn-settings-outline" disabled={!tableId || busy} onClick={() => void run(async () => {
          setPreview(null); setPreview(await previewMemoryTable(userId, tableId));
        })}>检查表格</button>
      </div>
      {preview && <div className="mn-settings-stack">
        <p className="mn-setlabel">{preview.rowCount} 条记录{preview.columnsToAdd.length > 0 && <>
          {` · 添加 ${preview.columnsToAdd.length} 列`}<InfoHint>{preview.columnsToAdd.join("、")}</InfoHint>
        </>}</p>
        {preview.issues.length ? <ul className="mn-raindrop-run-list">
          {preview.issues.slice(0, 10).map((issue, index) => <li className="mn-sethint" key={index}>
            {issue.row === null ? "表格" : `第 ${issue.row} 行`} · {issue.field && `${issue.field} · `}{issues[issue.code] ?? issue.code}
          </li>)}
          {preview.issues.length > 10 && <li className="mn-sethint">另有 {preview.issues.length - 10} 处问题</li>}
        </ul> : <div className="mn-setrow">
          <button type="button" className="mn-textbtn mn-settings-primary" disabled={busy} onClick={() => void run(async () => {
            onChange(await bindMemoryTable(userId, preview)); setPreview(null);
          })}>{binding ? "确认更换" : "确认绑定"}</button>
        </div>}
      </div>}
    </SettingsGroup>
    <SettingsGroup title="Agent 接入">
      <div className="mn-setrow">
        <div><p className="mn-setlabel">记忆库接入提示词</p><p className="mn-sethint">与具有记忆库权限的 MCP Token 一起发给 AI。</p></div>
        <button type="button" className="mn-textbtn mn-settings-outline" onClick={() => void copyPrompt()}>复制提示词</button>
      </div>
      {copyFeedback && <p className="mn-mcp-message" role="status">{copyFeedback}</p>}
      <div className="mn-setrow">
        <div><p className="mn-setlabel">记忆令牌<InfoHint>读权限覆盖绑定库里的个人和全部项目记忆。项目标识仅用于检索。修改记忆需要同时授予读、写权限。</InfoHint></p></div>
        <a className="mn-statuslink" href="/settings/mcp">管理令牌</a>
      </div>
    </SettingsGroup>
  </div>;
}
