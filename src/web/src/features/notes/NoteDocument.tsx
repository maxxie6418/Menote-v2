import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Clock, Code, Download, Eye, Paperclip, Pencil, Shield, Tag, Trash2, FolderInput, Table } from "lucide-react";
import type { Item, TopicNode } from "@menote/shared";
import { NoteEditor, type EditorKind } from "../editor";
import { MarkdownView } from "../markdown";
import { PropertyPanel } from "../props";
import { splitFrontmatter } from "../../lib/frontmatter";
import { TableBlockDialog, TableDocument } from "../table";
import { useItem } from "../../services/contentHooks";
import { degradeTableToNote, isBlankDraft, saveItemContent, saveItemMeta, setItemForm, softDeleteItem } from "../../services/contentService";
import { enableItemEncryption } from "../../services/encryptionCommandService";
import { purgeItemsPermanently } from "../../services/versionService";
import { exportNoteMarkdown, exportNoteZip, hasAttachmentRefs, uploadAttachment } from "../../services/attachmentService";
import { OrganizeDialog } from "./OrganizeDialog";
import { BlankFormChooser } from "./BlankFormChooser";
import { EncryptedNoteView } from "./EncryptedNoteView";
import { HistoryPanel } from "../versions";
import { EncryptSetupDialog } from "../encryption";
import { setSessionKey } from "../../services/keyringService";

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
  const [editorKind, setEditorKind] = useState<EditorKind>("wysiwyg");
  const [draft, setDraft] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [organizing, setOrganizing] = useState(false);
  const [tableDialog, setTableDialog] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [encrypting, setEncrypting] = useState(false);
  const [history, setHistory] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const getMarkdownRef = useRef<(() => string) | null>(null);
  const applyExternalRef = useRef<((markdown: string) => void) | null>(null);
  // 加密完成后本组件被 EncryptedNoteView 分支替代；此函数仅为类型占位。
  function setPlainDraftAfterEncryption(): void { /* EncryptedNoteView 接管 */ }

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
    if (!item || item.content.scope !== "plain") return;
    // 编辑器/预览只处理正文（FR-PROP-1：YAML 由属性区管理）；保存前把正文拼回 frontmatter。
    const currentFull = draft ?? item.content.markdown;
    const editorValue = overrideMarkdown ?? getMarkdownRef.current?.() ?? null;
    const { frontText } = splitFrontmatter(currentFull);
    const value = editorValue === null ? currentFull : frontText ? `${frontText}

${editorValue}` : editorValue;
    if (value === null || value === item.content.markdown) return;
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

  /** 附件上传（FR-SYNC-7）：sha256 内容寻址，插入相对路径引用（追加在正文末尾，M3 打磨光标插入）。 */
  const onUploadPicked = async (file: File | undefined) => {
    if (!file || uploading || !item) return;
    setUploading(true);
    try {
      const result = await uploadAttachment(file);
      if ("error" in result) {
        setSaveState({ kind: "error", message: result.error });
        return;
      }
      const latest = getMarkdownRef.current?.() ?? draft ?? (item.content.scope === "plain" ? item.content.markdown : "");
      const next = `${latest.trimEnd()}\n\n![${result.name}](attachments/${result.sha256}--${result.name})\n`;
      await saveFullMarkdown(next);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (!item) {
    return (
      <article className="mn-doc" aria-label="文档区">
        <DocBar crumb={crumb} showBack={showBack} onBack={onBack} mode={mode} onMode={switchMode} actionsDisabled />
        <div className="mn-empty" role="status" aria-busy="true" />
      </article>
    );
  }

  if (item.content.scope !== "plain") {
    return <EncryptedNoteView userId={userId} item={item} crumb={crumb} showBack={showBack} onBack={onBack} />;
  }

  const plain = item.content;
  const isTableDoc = item.type === "table";
  const showFormChooser = !isTableDoc && isBlankDraft(item);

  /** 形态选择（FR-TBL-9）：转换守卫在 setItemForm（仅空白期可切）。 */
  const pickTableForm = () => {
    setItemForm(userId, item.id, "table").catch((cause) => setSaveState({ kind: "error", message: String(cause) }));
  };
  const switchToNoteForm = () => {
    setItemForm(userId, item.id, "note").catch((cause) => setSaveState({ kind: "error", message: String(cause) }));
  };
  const degradeDoc = () => {
    degradeTableToNote(userId, item.id).catch((cause) => setSaveState({ kind: "error", message: String(cause) }));
  };

  return (
    <article className="mn-doc" aria-label="文档区">
      <DocBar
        crumb={crumb} showBack={showBack} onBack={onBack} mode={mode} onMode={switchMode}
        extra={(
          <>
            <button type="button" className="mn-iconbtn" aria-label="版本历史" title="版本历史" onClick={() => setHistory(true)}>
              <Clock />
            </button>
            <button type="button" className="mn-iconbtn" aria-label="启用单篇加密" title="启用单篇加密（独立密码+恢复码）" onClick={() => setEncrypting(true)}>
              <Shield />
            </button>
            <button type="button" className="mn-iconbtn" aria-label="插入附件" title="上传并插入附件（20MB 内）" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              <Paperclip />
            </button>
            {!isTableDoc && (
              <button type="button" className="mn-iconbtn" aria-label="表格结构化编辑" title="表格结构化编辑" onClick={() => setTableDialog(true)}>
                <Table />
              </button>
            )}
            <button type="button" className="mn-iconbtn" aria-label="导出" title="导出 zip / Markdown" onClick={() => setExporting(true)}>
              <Download />
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
        {showFormChooser && <BlankFormChooser onPickTable={pickTableForm} />}
        {plain && mode === "preview" && (
          <MarkdownView markdown={splitFrontmatter(draft ?? plain.markdown).body} className="md-body mn-doc-preview" />
        )}
        {plain && mode === "edit" && isTableDoc && (
          <TableDocument
            markdown={draft ?? plain.markdown}
            onChangeMarkdown={(next) => void saveFullMarkdown(next)}
            onDegrade={degradeDoc}
            onSwitchToNote={switchToNoteForm}
          />
        )}
        {plain && mode === "edit" && !isTableDoc && (
          <NoteEditor
            mode="edit"
            kind={editorKind}
            externalMarkdown={splitFrontmatter(plain.markdown).body}
            onInput={(value) => {
              const { frontText } = splitFrontmatter(draft ?? plain.markdown);
              setDraft(frontText ? `${frontText}

${value}` : value);
            }}
            registerGetMarkdown={(get) => { getMarkdownRef.current = get; }}
            registerApplyExternal={(apply: ((markdown: string) => void) | null) => {
              if (apply) applyExternalRef.current = (markdown: string) => apply(splitFrontmatter(markdown).body);
              else applyExternalRef.current = null;
            }}
          />
        )}
      </div>
      <div className="mn-doc-foot">
        <span>{(draft ?? (item.content.scope === "plain" ? item.content.markdown : "")).length} 字符</span>
        <span className="mn-doc-foot-right">
          {saveState.kind === "saving" && "保存中…"}
          {saveState.kind === "error" && (
            <button type="button" className="mn-savestate err" onClick={() => { void flush(); }}>保存失败 · 重试</button>
          )}
          {saveState.kind === "idle" && "已保存"}
        </span>
      </div>
      {tableDialog && (
        <TableBlockDialog
          markdown={draft ?? (plain ? plain.markdown : "")}
          onSave={(next) => { setTableDialog(false); void saveFullMarkdown(next); }}
          onClose={() => setTableDialog(false)}
          onExtract={(content) => { setTableDialog(false); void onExtractDoc(content); }}
        />
      )}
      {history && item && (
        <HistoryPanel userId={userId} itemId={item.id} currentMarkdown={draft ?? item.content.markdown} onClose={() => setHistory(false)} />
      )}
      {encrypting && item && (
        <EncryptSetupDialog
          onCancel={() => setEncrypting(false)}
          onConfirm={async (password, code) => {
            const latest = getMarkdownRef.current?.() ?? draft ?? (item.content.scope === "plain" ? item.content.markdown : "");
            const result = await enableItemEncryption(userId, item.id, latest, password, code);
            setSessionKey(item.id, result.key);
            setPlainDraftAfterEncryption();
            return "ok";
          }}
        />
      )}
      {exporting && item && (
        <div className="mn-overlay" role="presentation">
          <div className="mn-dialog" role="dialog" aria-modal="true" aria-label="导出">
            <p className="mn-dialog-title">导出「{item.title}」</p>
            {hasAttachmentRefs(item) && (
              <p className="mn-auth-hint">纯 Markdown 导出时附件引用会断链；zip 导出会随行附件目录。</p>
            )}
            {item.content.scope !== "plain" && (
              <p className="mn-auth-hint">已加密内容导出须先解锁（C-1：锁定态只能取得密文）。</p>
            )}
            <div className="mn-dialog-actions">
              <button type="button" className="mn-auth-submit" onClick={() => { void exportNoteZip(userId, item); setExporting(false); }}>
                导出 zip（含附件）
              </button>
              <button type="button" className="mn-auth-link" onClick={() => { exportNoteMarkdown(item); setExporting(false); }}>
                纯 Markdown
              </button>
              <button type="button" className="mn-auth-link" onClick={() => setExporting(false)}>取消</button>
            </div>
          </div>
        </div>
      )}
      <input ref={fileInputRef} type="file" hidden aria-hidden="true" onChange={(event) => void onUploadPicked(event.target.files?.[0])} />
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
  extra?: React.ReactNode;
}

function DocBar({ crumb, showBack, onBack, mode, onMode, actionsDisabled, extra }: DocBarProps) {
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
