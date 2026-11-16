/** Flomo 导入面板（FR-IMP-1）：选压缩包 → 看摘要 → 确认导入 → 进度与结果。
 *  批量导入先预览再落库；解析与写入都在本机完成，压缩包不离开这台设备。 */

import { useLayoutEffect, useRef, useState } from "react";
import { FolderInput } from "../../icons";
import type { FlomoExportData } from "../../lib/flomoParse";
import {
  importFlomoExport,
  readFlomoExport,
  type FlomoImportProgress,
  type FlomoImportResult,
} from "../../services/flomoImportService";

interface FlomoImportPanelProps {
  userId: string;
  onImported?: (result: FlomoImportResult) => void;
}

type Phase = "pick" | "preview" | "running" | "done";

function formatDate(timestamp: number | null): string {
  if (timestamp === null) return "—";
  return new Date(timestamp).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

/** 预览里的正文截断：只给开头，避免长文本把窗口撑开。 */
function previewText(markdown: string): string {
  const text = markdown.replace(/\{\{flomo-image:\d+\}\}/g, "［图片］").replace(/\s+/g, " ").trim();
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

export function FlomoImportPanel({ userId, onImported }: FlomoImportPanelProps) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [file, setFile] = useState<File | null>(null);
  const [data, setData] = useState<FlomoExportData | null>(null);
  const [progress, setProgress] = useState<FlomoImportProgress>({ phase: "parsing", done: 0, total: 0 });
  const [result, setResult] = useState<FlomoImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // 进度条宽度走 DOM API（结构检查禁止 JSX style prop）。
  useLayoutEffect(() => {
    const fill = barRef.current?.querySelector("i");
    if (!(fill instanceof HTMLElement)) return;
    fill.style.width = `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`;
  }, [progress]);

  const pickFile = async (next: File | null) => {
    if (!next) return;
    setError(null);
    setPhase("pick");
    try {
      const parsed = await readFlomoExport(next);
      if (parsed.memos.length === 0) {
        setError("这个压缩包里没有找到 Flomo 笔记。");
        return;
      }
      setFile(next);
      setData(parsed);
      setPhase("preview");
    } catch {
      setError("无法解析这个文件，请选择 Flomo 导出的压缩包。");
    }
  };

  const start = async () => {
    if (!file || !data) return;
    setPhase("running");
    setError(null);
    try {
      const outcome = await importFlomoExport(userId, file, setProgress, data);
      setResult(outcome);
      setPhase("done");
      onImported?.(outcome);
    } catch {
      setPhase("preview");
      setError("导入中断，请重试。已导入的条目不会重复。");
    }
  };

  return (
    <div className="mn-flomo-import">
      {phase === "pick" && (
        <>
          <p className="mn-sethint">选择 Flomo 导出的压缩包（.zip）。文件只在本机解析，不会上传到任何服务器。</p>
          <button type="button" className="mn-flomo-import-pick" onClick={() => fileRef.current?.click()}>
            <FolderInput aria-hidden="true" />选择压缩包
          </button>
          <input ref={fileRef} type="file" accept=".zip,application/zip" hidden aria-hidden="true"
            onChange={(event) => { void pickFile(event.target.files?.[0] ?? null); event.target.value = ""; }} />
        </>
      )}

      {phase === "preview" && data && (
        <>
          <dl className="mn-flomo-import-summary">
            <div><dt>笔记</dt><dd>{data.memos.length} 条</dd></div>
            <div><dt>时间范围</dt><dd>{formatDate(data.earliest)} — {formatDate(data.latest)}</dd></div>
            <div><dt>标签</dt><dd>{data.tags.length} 个</dd></div>
            <div><dt>图片</dt><dd>{data.imageCount} 张{data.missingImages > 0 ? `（${data.missingImages} 张缺失）` : ""}</dd></div>
          </dl>
          <div className="mn-flomo-import-preview" aria-label="导入预览">
            {data.memos.slice(0, 3).map((memo, index) => (
              <p key={`${memo.createdAt}-${index}`}>
                <time>{new Date(memo.createdAt).toLocaleString("zh-CN", { hour12: false })}</time>
                <span>{previewText(memo.markdown) || "［仅图片］"}</span>
              </p>
            ))}
            {data.memos.length > 3 && <p className="mn-flomo-import-more">还有 {data.memos.length - 3} 条…</p>}
          </div>
          <p className="mn-sethint">导入后每条笔记会成为一条随记，保留原始时间与正文里的 #标签，并统一带上 #flomo 标签。</p>
          <footer className="mn-dialog-actions">
            <button type="button" onClick={() => { setPhase("pick"); setData(null); setFile(null); }}>重新选择</button>
            <button type="button" className="mn-auth-submit" onClick={() => void start()}>开始导入</button>
          </footer>
        </>
      )}

      {phase === "running" && (
        <>
          <p className="mn-sethint" role="status">
            {progress.phase === "parsing" ? "正在解析压缩包…" : `正在导入 ${progress.done} / ${progress.total}…`}
          </p>
          <div ref={barRef} className="mn-flomo-import-bar" role="progressbar" aria-valuenow={progress.done} aria-valuemin={0} aria-valuemax={progress.total}>
            <i />
          </div>
        </>
      )}

      {phase === "done" && result && (
        <>
          <p className="mn-sethint" role="status">
            已导入 {result.imported} 条，跳过重复 {result.skipped} 条
            {result.empty > 0 ? `，空条目 ${result.empty} 条` : ""}
            {result.failed > 0 ? `，失败 ${result.failed} 条` : ""}。
            图片上传 {result.imagesUploaded} 张{result.imagesFailed > 0 ? `，跳过 ${result.imagesFailed} 张` : ""}。
          </p>
          <footer className="mn-dialog-actions">
            <button type="button" className="mn-auth-submit" onClick={() => { setPhase("pick"); setData(null); setFile(null); setResult(null); }}>完成</button>
          </footer>
        </>
      )}

      {error && <p className="mn-memo-action-error" role="alert">{error}</p>}
    </div>
  );
}
