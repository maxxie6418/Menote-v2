import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { DEFAULT_AI_SETTINGS, normalizeAiSettings, type AiSettings, type AiTaskKind, type AiTaskView, type AiUsageSummary } from "@menote/shared";
import { readAiSettings } from "../../services/aiSettingsService";
import { pollAiTask, readAiUsage, submitAiTask } from "../../services/aiService";
import { flushSync } from "../../services/syncEngine";
import { splitFrontmatter } from "../../lib/frontmatter";

export interface AiAssistDialogProps {
  userId: string;
  itemId: string;
  title: string;
  tags: string[];
  /** 完整 Markdown（含 frontmatter）；提交给推理的正文会剥离 YAML。 */
  markdown: string;
  /** 从清单「AI 概述」进入时自动提交一次摘要，仍须确认后才写入。 */
  autoRun?: AiTaskKind;
  onApplySummary: (summary: string) => Promise<boolean>;
  onApplyTags: (tags: string[]) => Promise<void>;
  onClose: () => void;
}

type RunState = { kind: "idle" } | { kind: "running" } | { kind: "error"; message: string };

/** AI 助手对话框（FR-AI-2 / 主文档 13.3）：摘要与标签推荐，手动触发、确认后才写入。 */
export function AiAssistDialog({ userId, itemId, title, tags, markdown, autoRun, onApplySummary, onApplyTags, onClose }: AiAssistDialogProps) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [run, setRun] = useState<RunState>({ kind: "idle" });
  const [task, setTask] = useState<AiTaskView | null>(null);
  const [usage, setUsage] = useState<AiUsageSummary | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void readAiSettings(userId).then((value) => {
        if (!cancelled) setSettings(value ? normalizeAiSettings(value) : { ...DEFAULT_AI_SETTINGS });
      });
    };
    refresh();
    window.addEventListener("menote:ai-settings", refresh);
    return () => { cancelled = true; window.removeEventListener("menote:ai-settings", refresh); };
  }, [userId]);

  useEffect(() => {
    const controller = new AbortController();
    void readAiUsage(controller.signal).then((value) => { if (value) setUsage(value); }).catch(() => {});
    return () => controller.abort();
  }, [task]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const runTask = useCallback(async (kind: AiTaskKind, force = false) => {
    setRun({ kind: "running" });
    setTask(null);
    try {
      const content = splitFrontmatter(markdown).body.trim();
      if (!content) {
        setRun({ kind: "error", message: "这篇没有可提交的正文" });
        return;
      }
      await flushSync(userId);
      const view = await submitAiTask({ itemId, kind, title, tags, content, force });
      const settled = view.status === "done" || view.status === "failed" ? view : await pollAiTask(view.id);
      setTask(settled);
      if (settled?.status === "failed") setRun({ kind: "error", message: settled.error ?? "AI 任务失败" });
      else if (!settled) setRun({ kind: "error", message: "AI 任务超时未完成，可稍后重试" });
      else setRun({ kind: "idle" });
    } catch (cause) {
      setRun({ kind: "error", message: cause instanceof Error ? cause.message : String(cause) });
    }
  }, [itemId, markdown, tags, title, userId]);

  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoRun || !settings?.enabled || autoStarted.current) return;
    autoStarted.current = true;
    void runTask(autoRun);
  }, [autoRun, runTask, settings?.enabled]);

  const summary = task?.status === "done" && task.result?.type === "summary" ? task.result.summary : null;
  const recommended = task?.status === "done" && task.result?.type === "tags" ? task.result.tags : null;

  useEffect(() => {
    if (recommended) setPicked(recommended.filter((tag) => !tags.includes(tag)));
  }, [recommended, tags]);

  return (
    <div className="mn-overlay" role="presentation">
      <div className="mn-dialog mn-ai-dialog" role="dialog" aria-modal="true" aria-label="AI 助手">
        <div className="mn-dialog-head">
          <p className="mn-dialog-title">AI 助手 · {title || "无标题"}</p>
          <button type="button" className="mn-iconbtn" aria-label="关闭" onClick={onClose}><X /></button>
        </div>
        <div className="mn-dialog-body">
          {settings && !settings.enabled && (
            <p className="mn-auth-hint">AI 功能未启用：在「设置 → AI 助手」中开启后再使用。加密内容不会提交云端 AI。</p>
          )}
          {settings?.enabled && (
            <>
              <div className="mn-ai-commands">
                <button type="button" className="mn-btn" disabled={run.kind === "running" || saving}
                  onClick={() => { void runTask("summary"); }}>
                  <Sparkles /> 生成概述
                </button>
                <button type="button" className="mn-btn" disabled={run.kind === "running" || saving}
                  onClick={() => { void runTask("tags"); }}>
                  <Sparkles /> 推荐标签
                </button>
              </div>
              {run.kind === "running" && <p className="mn-auth-hint" role="status">推理进行中，通常几秒内完成…</p>}
              {run.kind === "error" && <p className="mn-auth-hint" role="alert">{run.message}</p>}
              {summary !== null && (
                <div>
                  <p className="mn-setlabel">概述建议（确认后保存到标题下的属性「概述」，原文不变，可再编辑）</p>
                  <p className="mn-sethint">{summary}</p>
                  <div className="mn-ai-commands">
                    <button type="button" className="mn-btn" disabled={saving} onClick={() => {
                      setSaving(true);
                      void onApplySummary(summary).then((saved) => {
                        if (saved) onClose();
                        else setRun({ kind: "error", message: "概述保存失败，请检查文档属性后重试。" });
                      }).catch(() => setRun({ kind: "error", message: "概述保存失败，请重试。" })).finally(() => setSaving(false));
                    }}>
                      保存到属性区
                    </button>
                    <button type="button" className="mn-textbtn" disabled={saving} onClick={() => { void runTask("summary", true); }}>重新生成</button>
                  </div>
                </div>
              )}
              {recommended !== null && (
                <div>
                  <p className="mn-setlabel">标签推荐（确认后追加，不改动已有标签）</p>
                  {recommended.length === 0 && <p className="mn-sethint">模型没有给出可用的标签建议。</p>}
                  {recommended.map((tag) => {
                    const exists = tags.includes(tag);
                    const checked = exists || picked.includes(tag);
                    return (
                      <div key={tag} className="mn-setrow">
                        <span className="mn-setlabel">
                          <input type="checkbox" disabled={exists} checked={checked} aria-label={`采用标签 ${tag}`}
                            onChange={(event) => setPicked((current) => event.target.checked
                              ? [...current, tag]
                              : current.filter((entry) => entry !== tag))} />
                          {" "}#{tag}{exists ? "（已有）" : ""}
                        </span>
                      </div>
                    );
                  })}
                  <div className="mn-ai-commands">
                    <button type="button" className="mn-btn" disabled={picked.length === 0 || saving}
                      onClick={() => { setSaving(true); void onApplyTags(picked).then(onClose).catch(() => setRun({ kind: "error", message: "标签保存失败，请重试。" })).finally(() => setSaving(false)); }}>
                      采用所选{picked.length > 0 ? `（${picked.length} 个）` : ""}
                    </button>
                    <button type="button" className="mn-textbtn" disabled={saving} onClick={() => { void runTask("tags", true); }}>重新推荐</button>
                  </div>
                </div>
              )}
              {usage && (
                <p className="mn-sethint">今日 {usage.calls}/{usage.dailyCallLimit} 次调用 · 输入 {usage.inputTokens} / 输出 {usage.outputTokens} tokens；Workers AI 免费档约 {usage.freeNeuronsDaily.toLocaleString()} Neurons/日，以 Cloudflare 官方为准。</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
