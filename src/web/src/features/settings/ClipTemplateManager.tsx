import { useEffect, useState } from "react";
import { isClipTemplateV1, type ClipTemplateV1, type StoredClipTemplate } from "@menote/shared";
import { emptyClipTemplateDraft, listClipTemplates, removeClipTemplate, saveClipTemplate } from "../../services/clipTemplateService";
import { loadShared, peek, SETTINGS_CACHE } from "../../services/settingsPrefetch";

interface ImportReport {
  unsupported?: unknown[];
  result?: unknown;
  upstream?: { platform?: unknown; commit?: unknown };
}

interface TemplateEdit {
  id: string;
  version: number;
  draft: string;
}

function parseTemplateDraft(draft: string): ClipTemplateV1 | null {
  try {
    const value: unknown = JSON.parse(draft);
    return isClipTemplateV1(value) ? value : null;
  } catch {
    return null;
  }
}

export function ClipTemplateManager() {
  const [templates, setTemplates] = useState<StoredClipTemplate[]>(() => peek<StoredClipTemplate[]>(SETTINGS_CACHE.clipTemplates) ?? []);
  const [newDraft, setNewDraft] = useState(emptyClipTemplateDraft);
  const [editing, setEditing] = useState<TemplateEdit | null>(null);
  const [imported, setImported] = useState<ClipTemplateV1 | null>(null);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [listState, setListState] = useState<"loading" | "ready" | "error">(() => peek(SETTINGS_CACHE.clipTemplates) === undefined ? "loading" : "ready");
  const [listError, setListError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh(fresh = false) {
    if (peek(SETTINGS_CACHE.clipTemplates) === undefined) setListState("loading");
    try {
      setTemplates(await loadShared(SETTINGS_CACHE.clipTemplates, listClipTemplates, fresh));
      setListError("");
      setListState("ready");
    } catch (error) {
      setListState("error");
      setListError(error instanceof Error ? error.message : "unknown_error");
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
        const exists = templates.some((entry) => entry.template.id === value.id);
        setMessage(exists ? "该模板 ID 已存在；请在‘已有规则’中编辑对应规则。" : "模板已载入预览，请核对来源和转译报告。");
      } else {
        if (!value || typeof value !== "object" || !Array.isArray((value as ImportReport).unsupported)) throw new Error("报告缺少 unsupported 列表。");
        setImportReport(value as ImportReport);
        setMessage("转译报告已载入，请检查未支持项后再创建规则。");
      }
    } catch (error) {
      setMessage(error instanceof Error ? `导入文件失败：${error.message}` : "导入文件失败：JSON 格式错误。");
    }
  }

  function loadImportIntoNewRule() {
    if (!imported) return;
    if (templates.some((entry) => entry.template.id === imported.id)) {
      setMessage("该模板 ID 已存在。请使用‘已有规则’中的编辑操作，避免创建重复规则。");
      return;
    }
    setNewDraft(JSON.stringify(imported, null, 2));
    setMessage(`已载入新增规则：${imported.name}。点击‘创建规则’保存到当前账号。`);
  }

  async function createRule() {
    const template = parseTemplateDraft(newDraft);
    if (!template) { setMessage("新增规则 JSON 格式、字段或选择器无效，未保存。"); return; }
    if (templates.some((entry) => entry.template.id === template.id)) {
      setMessage("规则 ID 已存在。请修改新增规则 ID，或从‘已有规则’中编辑该规则。");
      return;
    }
    setBusy(true);
    try {
      await saveClipTemplate(template, null);
      await refresh(true);
      setNewDraft(emptyClipTemplateDraft());
      setImported(null);
      setMessage(`规则“${template.name}”已创建；默认状态为${template.enabled ? "启用" : "停用"}。`);
    } catch (error) {
      if (error instanceof Error && error.message === "version_conflict") {
        await refresh(true).catch(() => undefined);
        setMessage("规则 ID 已存在，列表已刷新；请从已有规则中编辑。");
      } else {
        setMessage(error instanceof Error && error.message === "invalid_template" ? "规则字段或选择器格式不正确。" : "创建失败，请重试。");
      }
    } finally { setBusy(false); }
  }

  async function saveExistingRule() {
    if (!editing) return;
    const template = parseTemplateDraft(editing.draft);
    if (!template) { setMessage("规则 JSON 格式、字段或选择器无效，未保存。"); return; }
    if (template.id !== editing.id) { setMessage("编辑时不能更改规则 ID。"); return; }
    setBusy(true);
    try {
      await saveClipTemplate(template, editing.version);
      setEditing(null);
      await refresh(true);
      setMessage(`规则“${template.name}”已更新。`);
    } catch (error) {
      if (error instanceof Error && error.message === "version_conflict") {
        setEditing(null);
        await refresh(true).catch(() => undefined);
        setMessage("规则已被其他修改更新，列表已刷新；请重新编辑最新版本。");
      } else {
        setMessage(error instanceof Error && error.message === "invalid_template" ? "规则字段或选择器格式不正确。" : "更新失败，请重试。");
      }
    } finally { setBusy(false); }
  }

  function exportRule(template: ClipTemplateV1) {
    const blob = new Blob([`${JSON.stringify(template, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const safeName = template.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim() || "clip-template";
    anchor.href = url;
    anchor.download = `${safeName}.template.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setMessage(`规则“${template.name}”已导出。`);
  }

  async function toggle(template: ClipTemplateV1, enabled: boolean) {
    setBusy(true);
    try {
      const stored = templates.find((entry) => entry.template.id === template.id);
      await saveClipTemplate({ ...template, enabled }, stored?.version ?? null);
      await refresh(true);
      setMessage(enabled ? "规则已启用。" : "规则已停用。插件同步后将更新本地缓存。");
    } catch {
      await refresh(true).catch(() => undefined);
      setMessage("规则可能已被其他修改更新，列表已重新读取。");
    } finally { setBusy(false); }
  }

  async function deleteRule(id: string) {
    setBusy(true);
    try {
      await removeClipTemplate(id);
      if (editing?.id === id) setEditing(null);
      await refresh(true);
      setMessage("规则已删除；插件下次同步时会移除缓存。");
    } catch {
      setMessage("删除规则失败。");
    } finally { setBusy(false); }
  }

  return <section className="mn-setsection">
    <h4 className="mn-setlabel">剪藏模板</h4>

    <section className="mn-cliptemplate-section" aria-labelledby="mn-cliptemplate-new-heading">
      <h4 className="mn-setlabel" id="mn-cliptemplate-new-heading">新增规则</h4>
      <div className="mn-cliptemplate-import">
        <label className="mn-setlabel" htmlFor="mn-clip-template-import">导入模板 JSON</label>
        <input id="mn-clip-template-import" type="file" accept=".json,application/json" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadImportFile(file, "template"); event.currentTarget.value = ""; }} />
        <label className="mn-setlabel" htmlFor="mn-clip-template-report">导入转译报告（可选）</label>
        <input id="mn-clip-template-report" type="file" accept=".json,application/json" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadImportFile(file, "report"); event.currentTarget.value = ""; }} />
        {imported && <div className="mn-cliptemplate-preview" role="region" aria-label="新规则导入预览">
          <p><strong>{imported.name}</strong> · {imported.match.hosts.join("、")} · {imported.enabled ? "启用" : "停用"}</p>
          <p>来源：{imported.source?.repository ?? imported.source?.kind ?? "未注明"} · {imported.source?.commit ?? "无固定 commit"} · {imported.source?.path ?? ""}</p>
          {importReport && <><p>报告：{String(importReport.result ?? "转译结果待审核")} {importReport.upstream?.platform ? `· ${String(importReport.upstream.platform)}` : ""} {importReport.upstream?.commit ? `· ${String(importReport.upstream.commit)}` : ""}</p>
            <ul>{importReport.unsupported!.map((item, index) => <li key={index}>{String(item)}</li>)}</ul></>}
          <button type="button" className="mn-btn" disabled={busy} onClick={loadImportIntoNewRule}>载入新增规则</button>
        </div>}
      </div>
      <label className="mn-setlabel" htmlFor="mn-clip-template-new-json">新增规则 JSON</label>
      <textarea id="mn-clip-template-new-json" className="mn-cliptemplate-json" rows={14} value={newDraft} onChange={(event) => setNewDraft(event.target.value)} />
      <div className="mn-cliptemplate-actions">
        <button type="button" className="mn-btn" disabled={busy} onClick={() => void createRule()}>创建规则</button>
        <button type="button" className="mn-btn" disabled={busy} onClick={() => { setNewDraft(emptyClipTemplateDraft()); setImported(null); setMessage("已重置新增规则草稿。"); }}>新建空白规则</button>
      </div>
    </section>

    <section className="mn-cliptemplate-section" aria-labelledby="mn-cliptemplate-existing-heading">
      <div className="mn-cliptemplate-heading">
        <h4 className="mn-setlabel" id="mn-cliptemplate-existing-heading">已有规则</h4>
        <button type="button" className="mn-btn" disabled={busy || listState === "loading"} onClick={() => void refresh(true).catch(() => undefined)}>刷新列表</button>
      </div>
      {listState === "loading" && <p className="mn-sethint" role="status">正在读取账号规则…</p>}
      {listState === "error" && <p className="mn-sethint" role="alert">规则列表读取失败：{listError}</p>}
      {templates.map(({ template, version }) => {
        const isAdapter = template.pipeline === "capture-clip";
        return <article className="mn-cliptemplate-card" key={template.id}>
          <div className="mn-cliptemplate-heading">
            <div>
              <p className="mn-setlabel">{template.name}</p>
              <p className="mn-sethint">
                {template.match.hosts.join("、")} · v{version} ·{" "}
                {isAdapter
                  ? `命令式 capture+clip（${template.adapter?.id} v${template.adapter?.version ?? "?"}）`
                  : `声明式模板（${template.source?.kind ?? "manual"}）`}
              </p>
            </div>
            <label><input type="checkbox" disabled={busy || editing?.id === template.id} checked={template.enabled} onChange={(event) => void toggle(template, event.target.checked)} /> 启用</label>
          </div>
          {isAdapter ? (
            <details className="mn-cliptemplate-preview">
              <summary>查看管线与来源</summary>
              <p>管线：命令式 capture + clip（提取实现随插件发行，此处管理注册信息与启停）</p>
              <p>适配器：{template.adapter?.id} · 版本 {template.adapter?.version ?? "?"}</p>
              <p>上游：{template.adapter?.upstream ? `edgeever@${template.adapter.upstream.slice(0, 8)}` : "无固定上游"}</p>
              <p>匹配站点：{template.match.hosts.join("、")}</p>
            </details>
          ) : (
            <details className="mn-cliptemplate-preview">
              <summary>查看匹配与提取规则</summary>
              <p>管线：声明式模板</p>
              <p>路径：{template.match.paths.join("、") || "全部路径"}</p>
              <p>标题：{template.selectors?.title.selector ?? "—"}</p>
              <p>正文：{template.selectors?.content.selector ?? "—"}</p>
              <p>排除：{template.exclude.join("、") || "无"}</p>
              <p>来源：{template.source?.repository ? `${template.source.repository}@${template.source.commit ?? ""} · ${template.source.path ?? ""}` : template.source?.kind ?? "manual"}</p>
            </details>
          )}
          <div className="mn-cliptemplate-actions">
            {isAdapter ? (
              <p className="mn-sethint">命令式规则的提取逻辑随插件版本更新；此处仅可启停，无需编辑。</p>
            ) : (
              <>
                <button type="button" className="mn-btn" disabled={busy} onClick={() => setEditing({ id: template.id, version, draft: JSON.stringify(template, null, 2) })}>编辑</button>
                <button type="button" className="mn-btn" disabled={busy} onClick={() => exportRule(template)}>导出</button>
                <button type="button" className="mn-btn" disabled={busy} onClick={() => void deleteRule(template.id)}>删除</button>
              </>
            )}
          </div>
          {editing?.id === template.id && <div className="mn-cliptemplate-edit">
            <label className="mn-setlabel" htmlFor={`mn-clip-template-edit-${template.id}`}>编辑规则 JSON</label>
            <textarea id={`mn-clip-template-edit-${template.id}`} className="mn-cliptemplate-json" rows={14} value={editing.draft} onChange={(event) => setEditing({ ...editing, draft: event.target.value })} />
            <div className="mn-cliptemplate-actions">
              <button type="button" className="mn-btn" disabled={busy} onClick={() => void saveExistingRule()}>保存修改</button>
              <button type="button" className="mn-btn" disabled={busy} onClick={() => setEditing(null)}>取消</button>
            </div>
          </div>}
        </article>;
      })}
    </section>
    {message && <p className="mn-sethint" role="status">{message}</p>}
  </section>;
}
