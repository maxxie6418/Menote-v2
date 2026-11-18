/** Obsidian 导入面板（FR-IMP-2）：添加来源（整库/文件夹/单个 md）→ 看摘要与勾选列表 →
 *  选目标（收件箱或主题/分组）→ 确认导入 → 进度与结果。
 *  扫描与解析都在本机完成，先勾选后导入；解析不到的图片引用在列表中标红并计数。 */

import { useLayoutEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { FolderInput, FilePlus2 } from "../../icons";
import type { TopicNode } from "@menote/shared";
import type { ObsidianScanData, ObsidianScannedFile } from "../../lib/obsidianParse";
import { readDirectoryInput, readFileInput, readDroppedItems, pickObsidianDirectory } from "../../lib/obsidianScan";
import {
  importObsidianNotes, listImportTargets, readObsidianSource,
  type ObsidianImportProgress, type ObsidianImportResult, type ObsidianImportTarget,
} from "../../services/obsidianImportService";

interface ObsidianImportPanelProps {
  userId: string;
  onImported?: (result: ObsidianImportResult) => void;
}

type Phase = "pick" | "preview" | "running" | "done";

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function folderOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "根目录" : path.slice(0, index);
}

export function ObsidianImportPanel({ userId, onImported }: ObsidianImportPanelProps) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [scanning, setScanning] = useState(false);
  const [data, setData] = useState<ObsidianScanData | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [targets, setTargets] = useState<TopicNode[]>([]);
  const [targetValue, setTargetValue] = useState("");
  const [progress, setProgress] = useState<ObsidianImportProgress>({ phase: "reading", done: 0, total: 0 });
  const [result, setResult] = useState<ObsidianImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dirInputRef = useRef<HTMLInputElement>(null);
  const mdInputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // 进度条宽度走 DOM API（结构检查禁止 JSX style prop）。
  useLayoutEffect(() => {
    const fill = barRef.current?.querySelector("i");
    if (!(fill instanceof HTMLElement)) return;
    fill.style.width = `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`;
  }, [progress]);

  /** 统一入口：无论整库、文件夹还是单文件，都收敛为扫描文件清单后解析。 */
  const scanSource = async (files: ObsidianScannedFile[], rootLabel: string) => {
    setError(null);
    const markdownCount = files.filter((entry) => /\.(md|markdown)$/i.test(entry.path.split("/").pop() ?? "")).length;
    if (markdownCount === 0) {
      setError("没有找到 Markdown 笔记。请拖入 Obsidian 库、文件夹或 .md 文件。");
      return;
    }
    setScanning(true);
    try {
      const parsed = await readObsidianSource(files, rootLabel, setProgress);
      setTargets(await listImportTargets(userId));
      setTargetValue("");
      setData(parsed);
      setSelected(new Set(parsed.drafts.map((draft) => draft.path)));
      setPhase("preview");
    } catch {
      setError("读取失败，请重试。文件没有被改动。");
    } finally {
      setScanning(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragOver(false);
    if (scanning || event.dataTransfer.items.length === 0) return;
    void readDroppedItems(event.dataTransfer.items)
      .then((files) => scanSource(files, files[0]?.path.split("/")[0] ?? "所选文件"))
      .catch(() => setError("读取拖入内容失败，请重试。"));
  };

  /** 整库/文件夹：优先 File System Access API；环境不支持时由 onChange 兜底。 */
  const pickDirectory = async () => {
    if (scanning) return;
    setError(null);
    let picked: Awaited<ReturnType<typeof pickObsidianDirectory>> = null;
    try {
      picked = await pickObsidianDirectory();
    } catch {
      return; // 用户取消选择不算错误。
    }
    if (picked) await scanSource(picked.files, picked.rootLabel);
    else dirInputRef.current?.click();
  };

  const onDirectoryPicked = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const files = readDirectoryInput(input);
    const rootLabel = input.files?.[0]?.webkitRelativePath.split("/")[0] ?? "所选文件夹";
    input.value = "";
    void scanSource(files, rootLabel);
  };

  const onMarkdownPicked = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const files = readFileInput(input);
    input.value = "";
    void scanSource(files, "所选文件");
  };

  const toggleDraft = (path: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const targetOf = (value: string): ObsidianImportTarget => {
    if (!value) return { topicId: null, groupId: null };
    const node = targets.find((topic) => topic.id === value);
    if (!node) return { topicId: null, groupId: null };
    return node.depth === 1 ? { topicId: node.parentId, groupId: node.id } : { topicId: node.id, groupId: null };
  };

  const start = async () => {
    if (!data || selected.size === 0) return;
    setPhase("running");
    setError(null);
    try {
      const outcome = await importObsidianNotes(userId, data, selected, targetOf(targetValue), setProgress);
      setResult(outcome);
      setPhase("done");
      onImported?.(outcome);
    } catch {
      setPhase("preview");
      setError("导入中断，请重试。已导入的条目不会重复。");
    }
  };

  const reset = () => {
    setPhase("pick");
    setData(null);
    setResult(null);
    setSelected(new Set());
    setProgress({ phase: "reading", done: 0, total: 0 });
  };

  const allSelected = data !== null && selected.size === data.drafts.length;
  const summary = data?.summary;

  return (
    <div className="mn-obsidian-import">
      {phase === "pick" && (
        <>
          <p className="mn-sethint">拖入 Obsidian 整库、任意文件夹或 .md 文件；也可以点按钮选择。文件只在本机解析，不会上传到任何服务器。</p>
          <div className={dragOver ? "mn-obsidian-drop is-over" : "mn-obsidian-drop"} role="region" aria-label="拖入导入来源"
            onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}>
            {scanning
              ? <p role="status">正在读取与解析{progress.total ? ` ${progress.done} / ${progress.total}` : "…"} </p>
              : <p>把 Obsidian 库、文件夹或 .md 文件拖到这里</p>}
          </div>
          <div className="mn-obsidian-pick-actions">
            <button type="button" className="mn-flomo-import-pick" disabled={scanning} onClick={() => void pickDirectory()}>
              <FolderInput aria-hidden="true" />选择整库或文件夹
            </button>
            <button type="button" className="mn-flomo-import-pick" disabled={scanning} onClick={() => mdInputRef.current?.click()}>
              <FilePlus2 aria-hidden="true" />选择 .md 文件
            </button>
          </div>
          <input ref={(node) => {
            // webkitdirectory 由运行时 DOM 属性生效（React 不认识它）；directory 为旧版兜底。
            if (node) { node.setAttribute("webkitdirectory", ""); node.setAttribute("directory", ""); }
          }} type="file" hidden aria-hidden="true" multiple onChange={onDirectoryPicked} />
          <input ref={mdInputRef} type="file" hidden aria-hidden="true" multiple accept=".md,.markdown,text/markdown" onChange={onMarkdownPicked} />
        </>
      )}

      {phase === "preview" && data && summary && (
        <>
          <dl className="mn-flomo-import-summary">
            <div><dt>来源</dt><dd>{summary.rootLabel}{summary.isVault ? "（识别为 Obsidian 整库）" : ""}</dd></div>
            <div><dt>笔记</dt><dd>{summary.notes} 篇</dd></div>
            <div><dt>图片</dt><dd>{summary.images} 张{summary.missingImageRefs > 0 ? `，${summary.missingImageRefs} 处引用缺失` : ""}</dd></div>
            <div><dt>其它</dt><dd>{summary.skipped} 个文件跳过 · {formatBytes(summary.totalBytes)}</dd></div>
          </dl>
          <label className="mn-setlabel" htmlFor="mn-obsidian-target">导入到</label>
          <select id="mn-obsidian-target" className="mn-obsidian-target" value={targetValue}
            onChange={(event) => setTargetValue(event.target.value)}>
            <option value="">收件箱</option>
            {targets.filter((topic) => topic.depth === 0).map((topic) => (
              <optgroup key={topic.id} label={topic.name}>
                <option value={topic.id}>{topic.name}</option>
                {targets.filter((group) => group.depth === 1 && group.parentId === topic.id)
                  .map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </optgroup>
            ))}
          </select>
          <div className="mn-obsidian-list" role="region" aria-label="待导入笔记列表">
            <label className="mn-obsidian-row mn-obsidian-row-head">
              <input type="checkbox" aria-label="全选或全不选" checked={allSelected}
                onChange={() => setSelected(allSelected ? new Set() : new Set(data.drafts.map((draft) => draft.path)))} />
              <span>已选 {selected.size} / {data.drafts.length} 篇</span>
            </label>
            {data.drafts.map((draft) => {
              const missing = draft.images.filter((ref) => ref.resolvedPath === null).length;
              return (
                <label key={draft.path} className="mn-obsidian-row">
                  <input type="checkbox" aria-label={`选择 ${draft.title}`} checked={selected.has(draft.path)} onChange={() => toggleDraft(draft.path)} />
                  <span className="mn-obsidian-row-main">
                    <strong>{draft.title}</strong>
                    <small>{folderOf(draft.path)} · {draft.characters} 字 · {draft.images.length} 图{missing > 0 ? ` · 缺 ${missing}` : ""} · {formatDate(draft.mtime)}</small>
                  </span>
                  {missing > 0 && <span className="mn-obsidian-row-missing" role="img" aria-label={`${missing} 处图片引用缺失`}>缺图 {missing}</span>}
                </label>
              );
            })}
          </div>
          <p className="mn-sethint">导入后每篇成为一条普通笔记：标题取文件名，正文（含 YAML 属性）原样保留，图片上传为附件并重写引用；缺图引用保留原文并在此标红。</p>
          <footer className="mn-dialog-actions">
            <button type="button" onClick={reset}>重新选择</button>
            <button type="button" className="mn-auth-submit" disabled={selected.size === 0} onClick={() => void start()}>
              开始导入（{selected.size} 篇）
            </button>
          </footer>
        </>
      )}

      {phase === "running" && (
        <>
          <p className="mn-sethint" role="status">
            {progress.phase === "uploading" ? "正在上传图片与准备正文…" : `正在导入 ${progress.done} / ${progress.total}…`}
          </p>
          <div ref={barRef} className="mn-flomo-import-bar" role="progressbar" aria-valuenow={progress.done} aria-valuemin={0} aria-valuemax={progress.total}>
            <i />
          </div>
        </>
      )}

      {phase === "done" && result && (
        <>
          <p className="mn-sethint" role="status">
            已导入 {result.imported} 篇，跳过重复 {result.skipped} 篇
            {result.empty > 0 ? `，空笔记 ${result.empty} 篇` : ""}
            {result.failed > 0 ? `，失败 ${result.failed} 篇` : ""}。
            图片上传 {result.imagesUploaded} 张{result.imagesFailed > 0 ? `，跳过 ${result.imagesFailed} 张` : ""}
            {result.unresolvedRefs > 0 ? `；${result.unresolvedRefs} 处图片引用未找到对应文件，正文已保留原文` : ""}。
          </p>
          <footer className="mn-dialog-actions">
            <button type="button" className="mn-auth-submit" onClick={reset}>完成</button>
          </footer>
        </>
      )}

      {error && <p className="mn-memo-action-error" role="alert">{error}</p>}
    </div>
  );
}
