import { useEffect, useState } from "react";
import type { ClipTemplateV1, StoredClipTemplate } from "@menote/shared";
import { listClipTemplates, removeClipTemplate, saveClipTemplate } from "../../services/clipTemplateService";

function emptyTemplate(): string { return `{
  "schemaVersion": 1,
  "id": "${crypto.randomUUID()}",
  "name": "新剪藏规则",
  "enabled": false,
  "match": { "hosts": ["example.com"], "paths": ["/*"] },
  "selectors": { "title": { "selector": "h1", "value": "text" }, "content": { "selector": "article", "value": "html" } },
  "exclude": [],
  "source": { "kind": "manual" }
}`; }

export function ClipTemplateManager() {
  const [templates, setTemplates] = useState<StoredClipTemplate[]>([]);
  const [draft, setDraft] = useState(emptyTemplate);
  const [editingVersion, setEditingVersion] = useState<number | null>(null);
  const [message, setMessage] = useState("剪藏规则与笔记读取权限相互独立；模板只保存选择器，不含网页内容。");
  const [busy, setBusy] = useState(false);
  async function refresh() { setTemplates(await listClipTemplates()); }
  useEffect(() => { void refresh().catch(() => setMessage("读取剪藏规则失败，请重新登录后重试。")); }, []);
  async function saveDraft() {
    let value: unknown;
    try { value = JSON.parse(draft); } catch { setMessage("JSON 格式错误。"); return; }
    setBusy(true);
    try {
      const template = value as ClipTemplateV1;
      const isExisting = templates.some((entry) => entry.template.id === template.id);
      await saveClipTemplate(template, isExisting ? editingVersion : null);
      const updated = await listClipTemplates(); setTemplates(updated);
      const current = updated.find((entry) => entry.template.id === template.id);
      if (current) { setEditingVersion(current.version); setDraft(JSON.stringify(current.template, null, 2)); }
      setMessage("规则已保存。");
    }
    catch (error) {
      if (error instanceof Error && error.message === "version_conflict") {
        await refresh(); setEditingVersion(null); setMessage("服务器已有更新版本，已刷新规则列表。点击该规则的“编辑”载入最新版本后再修改。");
      } else setMessage(error instanceof Error && error.message === "invalid_template" ? "规则字段或选择器格式不正确。" : "保存失败，请重试。");
    }
    finally { setBusy(false); }
  }
  async function toggle(template: ClipTemplateV1, enabled: boolean) {
    setBusy(true);
    try { const stored = templates.find((entry) => entry.template.id === template.id); await saveClipTemplate({ ...template, enabled }, stored?.version ?? null); await refresh(); setMessage(enabled ? "规则已启用。" : "规则已停用。插件同步后将更新本地缓存。"); }
    catch { await refresh().catch(() => undefined); setMessage("规则可能已被其他修改更新，列表已重新读取。"); } finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true); try { await removeClipTemplate(id); await refresh(); setMessage("规则已删除；插件下次同步时会移除缓存。"); }
    catch { setMessage("删除规则失败。"); } finally { setBusy(false); }
  }
  return <section className="mn-setsection">
    <h4 className="mn-setlabel">剪藏模板</h4>
    <p className="mn-sethint">规则存放在 Menote 账号中，扩展通过 MCP Token 同步。EdgeEver 转存规则是独立快照；不支持的动态逻辑不会自动执行。</p>
    {templates.map(({ template, version }) => <div className="mn-setrow" key={template.id}>
      <div><p className="mn-setlabel">{template.name}</p><p className="mn-sethint">{template.match.hosts.join("、")} · v{version} · {template.source?.kind ?? "manual"}</p>
        <details className="mn-cliptemplate-preview"><summary>预览匹配与提取规则</summary><p>路径：{template.match.paths.join("、") || "全部路径"}</p><p>标题：{template.selectors.title.selector}</p><p>正文：{template.selectors.content.selector}</p><p>排除：{template.exclude.join("、") || "无"}</p><p>来源：{template.source?.repository ? `${template.source.repository}@${template.source.commit ?? ""} · ${template.source.path ?? ""}` : template.source?.kind ?? "manual"}</p></details>
      </div>
      <label><input type="checkbox" disabled={busy} checked={template.enabled} onChange={(event) => void toggle(template, event.target.checked)} /> 启用</label>
      <button type="button" className="mn-btn" disabled={busy} onClick={() => { setDraft(JSON.stringify(template, null, 2)); setEditingVersion(version); setMessage(`正在编辑：${template.name}（v${version}）`); }}>编辑</button>
      <button type="button" className="mn-btn" disabled={busy} onClick={() => void remove(template.id)}>删除</button>
    </div>)}
    <label className="mn-setlabel" htmlFor="mn-clip-template-json">模板 JSON</label>
    <textarea id="mn-clip-template-json" className="mn-cliptemplate-json" rows={14} value={draft} onChange={(event) => setDraft(event.target.value)} />
    <div className="mn-setrow"><button type="button" className="mn-btn" disabled={busy} onClick={() => void saveDraft()}>保存规则</button><button type="button" className="mn-btn" onClick={() => { setDraft(emptyTemplate()); setEditingVersion(null); }}>新建空白规则</button><p className="mn-sethint" role="status">{message}</p></div>
  </section>;
}
