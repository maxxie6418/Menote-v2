import { useState } from "react";
import type { StoredClipTemplate } from "@menote/shared";
import { discoverEdgeEverAdapters, type EdgeEverAdapterCatalog } from "../../services/edgeeverImportService";
import { saveClipTemplate } from "../../services/clipTemplateService";

interface EdgeEverImporterProps {
  templates: StoredClipTemplate[];
  onImported: () => Promise<void>;
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return "读取适配列表失败。";
  if (error.message === "unsupported_repository") return "仅支持 EdgeEver（tianma-if/edgeever）。";
  if (error.message === "github_default_branch_missing" || error.message === "github_commit_invalid") return "无法读取 EdgeEver 当前版本。";
  if (error.message === "edgeever_adapters_not_found") return "该版本没有可识别的网页适配列表。";
  if (error.message === "edgeever_revision_unavailable") return "无法读取 EdgeEver 当前版本，请稍后重试。";
  if (error.message.startsWith("github_http_")) return `GitHub 请求失败（${error.message.replace("github_http_", "HTTP ")}）。`;
  return "读取适配列表失败，请稍后重试。";
}

export function EdgeEverImporter({ templates, onImported }: EdgeEverImporterProps) {
  const [repository, setRepository] = useState("edgeever");
  const [catalog, setCatalog] = useState<EdgeEverAdapterCatalog | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function scan() {
    setLoading(true);
    setCatalog(null);
    setSelected([]);
    setError("");
    setStatus("");
    try {
      setCatalog(await discoverEdgeEverAdapters(repository));
    } catch (reason) {
      setError(errorText(reason));
    } finally { setLoading(false); }
  }

  function toggle(platform: string) {
    setSelected((current) => current.includes(platform)
      ? current.filter((value) => value !== platform)
      : [...current, platform]);
  }

  async function importSelected() {
    if (!catalog) return;
    const existingIds = new Set(templates.map((entry) => entry.template.id));
    const candidates = catalog.adapters.filter((adapter) => selected.includes(adapter.platform) && adapter.template && !existingIds.has(adapter.template.id));
    if (!candidates.length) return;
    setImporting(true);
    setStatus("");
    let saved = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        await saveClipTemplate(candidate.template!, null);
        saved += 1;
      } catch {
        failed += 1;
      }
    }
    try {
      await onImported();
      setStatus(`已导入 ${saved} 条${failed ? `，失败 ${failed} 条` : ""}。`);
      setSelected([]);
    } catch {
      setStatus(`已提交 ${saved} 条${failed ? `，失败 ${failed} 条` : ""}；规则列表刷新失败。`);
    } finally { setImporting(false); }
  }

  const selectedCount = catalog?.adapters.filter((adapter) => selected.includes(adapter.platform) && adapter.template &&
    !templates.some((entry) => entry.template.id === adapter.template!.id)).length ?? 0;

  return <section className="mn-edgeever-importer" aria-labelledby="mn-edgeever-importer-heading">
    <h5 className="mn-setlabel" id="mn-edgeever-importer-heading">EdgeEver 导入器</h5>
    <div className="mn-edgeever-source">
      <label className="mn-setlabel" htmlFor="mn-edgeever-repository">仓库</label>
      <input id="mn-edgeever-repository" className="mn-edgeever-repository" value={repository} onChange={(event) => setRepository(event.target.value)} disabled={loading || importing} />
      <button type="button" className="mn-btn" disabled={loading || importing || !repository.trim()} onClick={() => void scan()}>{loading ? "读取中…" : "读取适配列表"}</button>
    </div>
    {error && <p className="mn-sethint" role="alert">{error}</p>}
    {catalog && <>
      <p className="mn-sethint">{catalog.repository} · {catalog.branch} · {catalog.commit}</p>
      <div className="mn-edgeever-adapter-list">
        {catalog.adapters.map((adapter) => {
          const existing = adapter.template && templates.some((entry) => entry.template.id === adapter.template!.id);
          const canSelect = Boolean(adapter.template) && !existing && !importing;
          return <div className="mn-edgeever-adapter" key={adapter.platform}>
            <input type="checkbox" aria-label={`选择 ${adapter.platform}`} checked={selected.includes(adapter.platform)} disabled={!canSelect} onChange={() => toggle(adapter.platform)} />
            <div>
              <div className="mn-edgeever-adapter-title">
                <strong>{adapter.platform}</strong>
                <span className={existing ? "mn-edgeever-state-existing" : adapter.template ? "mn-edgeever-state-ready" : "mn-edgeever-state-unsupported"}>
                  {existing ? "已有规则" : adapter.template ? "可导入" : "不可转译"}
                </span>
              </div>
              <p className="mn-sethint">{adapter.hosts.join("、") || "—"} · {adapter.paths.join("、") || "—"}</p>
              {adapter.unsupported.length > 0 && <details className="mn-edgeever-limitations">
                <summary>{adapter.template ? "转译限制" : "不可转译原因"}</summary>
                <ul>{adapter.unsupported.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
              </details>}
            </div>
          </div>;
        })}
      </div>
      <button type="button" className="mn-btn" disabled={importing || selectedCount === 0} onClick={() => void importSelected()}>
        {importing ? "导入中…" : `导入所选规则${selectedCount ? `（${selectedCount}）` : ""}`}
      </button>
    </>}
    {status && <p className="mn-sethint" role="status">{status}</p>}
  </section>;
}
