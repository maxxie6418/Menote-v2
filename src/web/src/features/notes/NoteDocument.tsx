import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Eye, Pencil, Tag, Trash2, FolderInput, Table } from "lucide-react";
import type { Item, TopicNode } from "@menote/shared";
import { NoteEditor } from "../editor";
import { MarkdownView } from "../markdown";
import { PropertyPanel } from "../props";
import { TableBlockDialog } from "../table";
import { useItem } from "../../services/contentHooks";
import { saveItemContent, saveItemMeta, softDeleteItem } from "../../services/contentService";
import { OrganizeDialog } from "./OrganizeDialog";

const AUTOSAVE_DEBOUNCE_MS = 800;

interface NoteDocumentProps {
  userId: string;
  noteId: string;
  topics: TopicNode[];
  unfiled: boolean;
  onBack: () => void;
  showBack: boolean;
  crumb: string;
  /** FR-TBL-3：表格抽出为独立表格文档（fields: + 表格主体）。 */
  onExtractDoc: (content: string) => void;
}

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "error"; message: string };

/** 文档区（FR-EDT-1/2 源码形态：编辑/预览两常驻模式；自动保存静默后台化，NFR-10）。 */
export function NoteDocument({ userId, noteId, topics, unfiled, onBack, showBack, crumb, onExtractDoc }: NoteDocumentProps) {
  const item = useItem(userId, noteId);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [draft, setDraft] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [organizing, setOrganizing] = useState(false);
  const [tableDialog, setTableDialog] = useState(false);
  const getMarkdownRef = useRef<(() => string) | null>(null);
  const applyExternalRef = useRef<((markdown: string) => void) | null>(null);

  /** 统一文档更新链路（FR-PROP-3）：属性区/表格写回与正文草稿合并后保存，并回灌编辑器。 */
  const saveFullMarkdown = useCallback(async (next: string) => {
    if (!item) return;
    setDraft(next);
    setSaveState({ kind: "saving" });
    try {
      const saved = await saveItemContent(userId, item.id, next);
      const savedMarkdown = saved.content.scope === "plain" ? saved.content.markdown : "";
      setDraft(savedMarkdown);
      applyExternalRef.current?.(savedMarkdown);
      setSaveState({ kind: "idle" });
    } catch (cause) {
      setSaveState({ kind: "error", message: String(cause) });
    }
  }, [item, userId]);

  // noteId 变化时初始化（父组件以 key 重挂载，这里兜底异步到达）。
  useEffect(() => {
    if (item && draft === null) setDraft(item.content.scope === "plain" ? item.content.markdown : "");
    if (item && title === null) setTitle(item.title);
  }, [item, draft, title]);

  const flush = useCallback(async (overrideMarkdown?: string) => {
    if (!item) return;
    const value = overrideMarkdown ?? getMarkdownRef.current?.() ?? draft;
    if (item.content.scope !== "plain" || value === null || value === item.content.markdown) return;
    setSaveState({ kind: "saving" });
    try {
      const saved = await saveItemContent(userId, item.id, value);
      setDraft(saved.content.scope === "plain" ? saved.content.markdown : "");
      setSaveState({ kind: "idle" });
    } catch (cause) {
      setSaveState({ kind: "error", message: String(cause) });
    }
  }, [item, userId, draft]);

  // 自动保存防抖（键入不停顿不打断；失败有可见但不阻断的提示与重试）。
  useEffect(() => {
    if (draft === null || !item) return;
    const timer = setTimeout(() => { void flush(); }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, flush, item]);

  // 卸载前尽力落盘（异步保存不阻塞返回；失败保留本地草稿，本地库本就是权威）。
  useEffect(() => () => {
    const value = getMarkdownRef.current?.();
    if (item && value !== null && value !== undefined && item.content.scope === "plain" && value !== item.content.markdown) {
      void saveItemContent(userId, item.id, value).catch(() => {});
    }
  }, [item, userId]);

  const flushTitle = useCallback(async (nextTitle: string) => {
    if (!item) return;
    const clean = nextTitle.trim() || "无标题";
    if (clean === item.title) return;
    try {
      await saveItemMeta(userId, item.id, { title: clean });
      setSaveState({ kind: "idle" });
    } catch (cause) {
      setSaveState({ kind: "error", message: String(cause) });
    }
  }, [item, userId]);

  useEffect(() => {
    if (title === null || !item) return;
    const timer = setTimeout(() => { void flushTitle(title); }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [title, flushTitle, item]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flush();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flush]);

  const switchMode = async (next: "edit" | "preview") => {
    if (next === "preview") await flush();
    setMode(next);
  };

  const addTag = async (raw: string) => {
    const tag = raw.trim().replace(/^#/, "");
    if (!item || !tag || item.tags.includes(tag)) return;
    await saveItemMeta(userId, item.id, { tags: [...item.tags, tag] });
  };

  if (!item) {
    return (
      <article className="mn-doc" aria-label="文档区">
        <DocBar crumb={crumb} showBack={showBack} onBack={onBack} mode={mode} onMode={switchMode} actionsDisabled />
        <div className="mn-empty" role="status" aria-busy="true" />
      </article>
    );
  }

  const plain = item.content.scope === "plain" ? item.content : null;

  return (
    <article className="mn-doc" aria-label="文档区">
      <DocBar
        crumb={crumb} showBack={showBack} onBack={onBack} mode={mode} onMode={switchMode}
        saveState={saveState} onRetry={() => void flush()}
        extra={(
          <>
            <button type="button" className="mn-iconbtn" aria-label="表格结构化编辑" title="表格结构化编辑" onClick={() => setTableDialog(true)}>
              <Table />
            </button>
            {unfiled && (
              <button type="button" className="mn-iconbtn" aria-label="整理到主题" title="整理到主题" onClick={() => setOrganizing(true)}>
                <FolderInput />
              </button>
            )}
            <button type="button" className="mn-iconbtn" aria-label="移入回收站" title="移入回收站" onClick={() => void softDeleteItem(userId, item.id)}>
              <Trash2 />
            </button>
          </>
        )}
      />
      <div className="mn-docbody">
        <input
          className="mn-doc-title" value={title ?? item.title ?? ""} aria-label="标题"
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => { if (title !== null) void flushTitle(title); }}
          key={item.id}
        />
        {plain && (
          <PropertyPanel
            markdown={draft ?? plain.markdown}
            onSave={(next) => void saveFullMarkdown(next)}
          />
        )}
        <div className="mn-doc-tags" aria-label="标签">
          <Tag className="mn-doc-tags-icon" />
          {item.tags.map((tag) => (
            <button key={tag} type="button" className="mn-tagchip" title="移除标签"
              onClick={() => void saveItemMeta(userId, item.id, { tags: item.tags.filter((row) => row !== tag) })}>
              #{tag}×
            </button>
          ))}
          <input
            className="mn-taginput" placeholder="加标签，回车确认" aria-label="添加标签"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void addTag(event.currentTarget.value);
                event.currentTarget.value = "";
              }
            }}
          />
        </div>
        {plain && mode === "preview" && (
          <MarkdownView markdown={draft ?? plain.markdown} className="md-body mn-doc-preview" />
        )}
        {plain && mode === "edit" && (
          <NoteEditor
            mode="edit"
            externalMarkdown={plain.markdown}
            onInput={(value) => setDraft(value)}
            registerGetMarkdown={(get) => { getMarkdownRef.current = get; }}
            registerApplyExternal={(apply) => { applyExternalRef.current = apply; }}
          />
        )}
      </div>
      {tableDialog && (
        <TableBlockDialog
          markdown={draft ?? (plain ? plain.markdown : "")}
          onSave={(next) => { setTableDialog(false); void saveFullMarkdown(next); }}
          onClose={() => setTableDialog(false)}
          onExtract={(content) => { setTableDialog(false); void onExtractDoc(content); }}
        />
      )}
      {organizing && (
        <OrganizeDialog
          item={item} topics={topics} onDone={() => { setOrganizing(false); onBack(); }}
          onMove={async (topicId, groupId) => { await saveItemMeta(userId, item.id, { topicId, groupId }); }}
          onDelete={async () => { await softDeleteItem(userId, item.id); }}
        />
      )}
    </article>
  );
}

interface DocBarProps {
  crumb: string;
  showBack: boolean;
  onBack: () => void;
  mode: "edit" | "preview";
  onMode: (mode: "edit" | "preview") => void;
  actionsDisabled?: boolean;
  saveState?: SaveState;
  onRetry?: () => void;
  extra?: React.ReactNode;
}

function DocBar({ crumb, showBack, onBack, mode, onMode, actionsDisabled, saveState, onRetry, extra }: DocBarProps) {
  return (
    <div className="mn-docbar">
      <span className="mn-docbar-left">
        {showBack && (
          <button type="button" className="mn-iconbtn" aria-label="返回清单" onClick={onBack}>
            <ChevronLeft />
          </button>
        )}
        <span className="mn-crumb">{crumb}</span>
      </span>
      <span className="mn-docbar-right">
        {saveState?.kind === "saving" && <span className="mn-savestate">保存中…</span>}
        {saveState?.kind === "error" && (
          <button type="button" className="mn-savestate err" onClick={onRetry}>保存失败 · 重试</button>
        )}
        {extra}
        <span className="mn-vt" role="group" aria-label="编辑/预览切换">
          <button type="button" className={mode === "edit" ? "on" : ""} aria-label="编辑" aria-pressed={mode === "edit"}
            disabled={actionsDisabled} onClick={() => onMode("edit")}><Pencil /></button>
          <button type="button" className={mode === "preview" ? "on" : ""} aria-label="预览" aria-pressed={mode === "preview"}
            disabled={actionsDisabled} onClick={() => onMode("preview")}><Eye /></button>
        </span>
      </span>
    </div>
  );
}
