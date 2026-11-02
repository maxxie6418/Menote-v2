import { useEffect, useState } from "react";
import { isClipTemplateV1, type ClipTemplateV1, type StoredClipTemplate } from "@menote/shared";
import { emptyClipTemplateDraft, listClipTemplates, removeClipTemplate, saveClipTemplate } from "../../services/clipTemplateService";

interface ImportReport {
  unsupported?: unknown[];
  result?: unknown;
  upstream?: { platform?: unknown; commit?: unknown };
}

export function ClipTemplateManager() {
  const [templates, setTemplates] = useState<StoredClipTemplate[]>([]);
  const [draft, setDraft] = useState(emptyClipTemplateDraft);
  const [editingVersion, setEditingVersion] = useState<number | null>(null);
  const [imported, setImported] = useState<ClipTemplateV1 | null>(null);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [listState, setListState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("剪藏规则与笔记读取权限相互独立；模板只保存选择器，不含网页内容。");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setListState("loading");
    try {
      setTemplates(await listClipTemplates());
      setListState("ready");
    } catch (error) {
      setListState("error");
      setMessage(error instanceof Error ? `读取规则失败（${error.message}）。请确认已登录且当前 Worker 已部署模板管理接口。` : "读取规则失败。请确认已登录且当前 Worker 已部署模板管理接口。");
      throw error;
    }
  }
  useEffect(() => { void refresh().catch(() => undefined); }, []);
  async function loadImportFile(file: File, kind: "template" | "report") {
    try {
      const value: unknown = JSON.parse(await file.text());
      if (kind === "template") {
        if (!isClipTemplateV1(value)) throw new Error("模板不符合 ClipTemplateV1 格式或安全限制。");
        setImported(value);
        setImportReport(null);
        const existing = templates.find((entry) => entry.template.id === value.id);
        setMessage(existing ? `已载入导入预览；保存时将按当前 v${existing.version} 版本更新同 ID 规则。` : "已载入导入预览；保存前请核对来源和转换报告。");
      } else {
        if (!value || typeof value !== "object" || !Array.isArray((value as ImportReport).unsupported)) throw new Error("报告缺少 unsupported 列表。");
        setImportReport(value as ImportReport);
        setMessage("转译报告已载入，请检查未支持项后再保存规则。");
      }
    } catch (error) {
      setMessage(error instanceof Error ? `导入文件失败：${error.message}` : "导入文件失败：JSON 格式错误。");
    }
  }
  function applyImport() {
    if (!imported) return;
    const existing = templates.find((entry) => entry.template.id === imported.id);
    setDraft(JSON.stringify(imported, null, 2));
    setEditingVersion(existing?.version ?? null);
    setMessage(existing ? `导入内容已载入编辑区；保存将更新 ${existing.template.name}（v${existing.version}）。` : `导入内容已载入编辑区：${imported.name}。保存后会出现在上方规则列表。`);
  }
  async function saveDraft() {
    let value: unknown;
    try { value = JSON.parse(draft); } catch { setMessage("JSON 格式错误。"); return; }
    if (!isClipTemplateV1(value)) { setMessage("模板字段或选择器格式不正确，未保存。"); return; }
    setBusy(true);
    try {
      const template = value;
      const isExisting = templates.some((entry) => entry.template.id === template.id);
      await saveClipTemplate(template, isExisting ? editingVersion : null);
      const updated = await listClipTemplates(); setTemplates(updated);
      setListState("ready");
      const current = updated.find((entry) => entry.template.id === template.id);
      if (current) { setEditingVersion(current.version); setDraft(JSON.stringify(current.template, null, 2)); }
      setImported(null);
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
    <p className="mn-sethint">规则存放在 Menote 账号中，扩展通过 MCP Token 同步。导入 EdgeEver 转存 JSON 后先核对转译报告；规则默认停用，不支持的动态逻辑不会执行。</p>
    <div className="mn-setrow">
      <div className="mn-cliptemplate-import">
      <label className="mn-setlabel" htmlFor="mn-clip-template-import">导入转译模板 JSON</label>
      <input id="mn-clip-template-import" type="file" accept=".json,application/json" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadImportFile(file, "template"); event.currentTarget.value = ""; }} />
      <label className="mn-setlabel" htmlFor="mn-clip-template-report">导入转译报告（可选）</label>
      <input id="mn-clip-template-report" type="file" accept=".json,application/json" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadImportFile(file, "report"); event.currentTarget.value = ""; }} />
      {imported && <div className="mn-cliptemplate-preview" role="region" aria-label="转译模板预览">
        <p><strong>{imported.name}</strong> · {imported.match.hosts.join("、")} · {imported.enabled ? "启用" : "停用"}</p>
        <p>来源：{imported.source?.repository ?? imported.source?.kind ?? "未注明"} · {imported.source?.commit ?? "无固定 commit"} · {imported.source?.path ?? ""}</p>
        {importReport && <><p>报告：{String(importReport.result ?? "转译结果待审核")} {importReport.upstream?.platform ? `· ${String(importReport.upstream.platform)}` : ""} {importReport.upstream?.commit ? `· ${String(importReport.upstream.commit)}` : ""}</p>
          <ul>{importReport.unsupported!.map((item, index) => <li key={index}>{String(item)}</li>)}</ul></>}
        <button type="button" className="mn-btn" disabled={busy} onClick={applyImport}>载入编辑区</button>
      </div>}
      </div>
    </div>
    <div className="mn-setrow">
      <h5 className="mn-setlabel">已有规则</h5>
      <button type="button" className="mn-btn" disabled={busy || listState === "loading"} onClick={() => void refresh().catch(() => undefined)}>刷新列表</button>
    </div>
    {listState === "loading" && <p className="mn-sethint" role="status">正在读取账号规则…</p>}
    {listState === "error" && <p className="mn-sethint" role="alert">规则列表读取失败。请重新登录或稍后刷新；若持续失败，请检查 Worker 部署和数据库迁移。</p>}
    {listState === "ready" && templates.length === 0 && <p className="mn-sethint">当前账号还没有已保存的剪藏规则。转译器生成的 JSON 需在上方导入并保存后才会列出。</p>}
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
    <div className="mn-setrow"><button type="button" className="mn-btn" disabled={busy} onClick={() => void saveDraft()}>保存规则</button><button type="button" className="mn-btn" onClick={() => { setDraft(emptyClipTemplateDraft()); setEditingVersion(null); }}>新建空白规则</button><p className="mn-sethint" role="status">{message}</p></div>
  </section>;
}
