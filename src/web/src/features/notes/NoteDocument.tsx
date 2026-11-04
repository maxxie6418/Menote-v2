import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Clock, Code, Copy, Download, Eye, FileText, MoreHorizontal, Paperclip, Pencil, Shield, Sparkles, Table2, Tag, Trash2, FolderInput } from "lucide-react";
import type { Item, TopicNode } from "@menote/shared";
import { NoteEditor, type EditorKind } from "../editor";
import { MarkdownView } from "../markdown";
import { PropertyPanel } from "../props";
import { joinFrontmatter, splitFrontmatter } from "../../lib/frontmatter";
import { TableDocument } from "../table";
import { AiAssistDialog } from "../ai";
import { useItem } from "../../services/contentHooks";
import { degradeTableToNote, isConvertibleBlankDraft, saveItemContent, saveItemMeta, setItemForm, softDeleteItem } from "../../services/contentService";
import { enableItemEncryption } from "../../services/encryptionCommandService";
import { purgeItemsPermanently } from "../../services/versionService";
import { exportNoteMarkdown, exportNoteZip, hasAttachmentRefs, uploadAttachment } from "../../services/attachmentService";
import { OrganizeDialog } from "./OrganizeDialog";
import { DocTitle } from "./DocTitle";
import { TemplatePicker, type TemplateOption } from "./TemplatePicker";
import { EncryptedNoteView } from "./EncryptedNoteView";
import { HistoryPanel } from "../versions";
import { EncryptSetupDialog } from "../encryption";
import { setSessionKey } from "../../services/keyringService";
import { itemRoutePath } from "../../app/appRoutes";

const AUTOSAVE_DEBOUNCE_MS = 800;

/** 新文档可选模板（正文区正中浮出的小方块）。加模板就往这里续，渲染按一排五个的宽度排。 */
const TEMPLATES: TemplateOption[] = [
  { id: "note", name: "普通笔记", hint: "直接写正文，Markdown 原文", icon: <FileText size={16} /> },
  { id: "table", name: "多维表格", hint: "表格式整理，字段带类型", icon: <Table2 size={16} /> },
];

interface NoteDocumentProps {
  userId: string;
  noteId: string;
  topics: TopicNode[];
  unfiled: boolean;
  onBack: () => void;
  showBack: boolean;
  crumb: string;
  /** 清单右键「AI 概述」：token 变化时打开对话框并开始生成。 */
  openSummaryToken?: number;
}

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "error"; message: string };

/** 文档区（FR-EDT-1/2 源码形态：编辑/预览两常驻模式；自动保存静默后台化，NFR-10）。 */
export function NoteDocument({ userId, noteId, topics, unfiled, onBack, showBack, crumb, openSummaryToken }: NoteDocumentProps) {
  const item = useItem(userId, noteId);
  // 冲突副本：记录它顶掉了哪一条目（G2 §5-2），文档区给出回溯入口供人工裁决。
  const conflictOf = item?.conflictOf ?? null;
  const conflictSource = useItem(userId, conflictOf);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [editorKind, setEditorKind] = useState<EditorKind>("wysiwyg");
  const [draft, setDraft] = useState<string | null>(null);
  // 脏计数：编辑器的 onInput 只是「正文变了」的信号，不带正文（FR-EDT-10）。
  // 用计数递增触发自动保存，正文在保存时从编辑器取全量。
  const [dirtyTick, setDirtyTick] = useState(0);
  // 模板选择块是否已被点选（点过就收起；直接开写也由 dirtyTick 收起）。
  const [templatePicked, setTemplatePicked] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [organizing, setOrganizing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [encrypting, setEncrypting] = useState(false);
  const [history, setHistory] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [aiAssist, setAiAssist] = useState(false);
  const [autoSummary, setAutoSummary] = useState(false);
  // AI 面板用的正文：打开面板时取一次**编辑器里的最新正文**。
  // 键入不再实时更新 draft（FR-EDT-10），直接用 draft 会把未保存的编辑漏给模型。
  const [aiMarkdown, setAiMarkdown] = useState<string | null>(null);
  const latestFullMarkdown = (): string => {
    const base = draft ?? (item?.content.scope === "plain" ? item.content.markdown : "");
    const body = getMarkdownRef.current?.();
    return body === undefined || body === null ? base : joinFrontmatter(splitFrontmatter(base).frontText, body);
  };
  useEffect(() => {
    if (!openSummaryToken) return;
    setAutoSummary(true);
    setAiMarkdown(latestFullMarkdown());
    setAiAssist(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSummaryToken]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const getMarkdownRef = useRef<(() => string) | null>(null);
  const applyExternalRef = useRef<((markdown: string) => void) | null>(null);
  // 加密完成后本组件被 EncryptedNoteView 分支替代；此函数仅为类型占位。
  function setPlainDraftAfterEncryption(): void { /* EncryptedNoteView 接管 */ }

  /** 统一文档更新链路（FR-PROP-3）：属性区/表格写回与正文草稿合并后保存，并回灌编辑器。 */
  const saveFullMarkdown = useCallback(async (next: string) => {
    if (!item) return;
    // 正文以**编辑器的最新内容**为准（FR-EDT-10 的连带影响）：
    // 键入不再实时更新 draft，属性区与 AI 面板回传的 next 是基于「上次保存的正文」拼的，
    // 直接落盘会把用户尚未保存的正文编辑覆盖掉。frontmatter 仍取 next 里的那份（属性区管 YAML）。
    // 编辑器没挂载时（整页表格形态）没有取值器，就用 next 原样保存。
    const editorBody = getMarkdownRef.current?.();
    const value = editorBody === undefined || editorBody === null
      ? next
      : joinFrontmatter(splitFrontmatter(next).frontText, editorBody);
    setDraft(value);
    setSaveState({ kind: "saving" });
    try {
      const saved = await saveItemContent(userId, item.id, value);
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
    const value = editorValue === null ? currentFull : joinFrontmatter(frontText, editorValue);
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
  // 依赖脏计数而不是正文：键入路径不再整篇序列化，flush 时才从编辑器取全量（FR-EDT-10）。
  useEffect(() => {
    if (draft === null || !item) return;
    const timer = setTimeout(() => { void flush(); }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [dirtyTick, flush, item]);

  // 卸载前尽力落盘（异步保存不阻塞返回；失败保留本地草稿，本地库本就是权威）。
  // 编辑器只持有正文，必须拼回 frontmatter，否则有属性的笔记离开时会把 YAML 写丢。
  useEffect(() => () => {
    const body = getMarkdownRef.current?.();
    if (!item || body === null || body === undefined || item.content.scope !== "plain") return;
    const value = joinFrontmatter(splitFrontmatter(item.content.markdown).frontText, body);
    if (value !== item.content.markdown) void saveItemContent(userId, item.id, value).catch(() => {});
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
      const latest = getMarkdownRef.current?.() ?? splitFrontmatter(draft ?? (item.content.scope === "plain" ? item.content.markdown : "")).body;
      const next = joinFrontmatter(splitFrontmatter(draft ?? "").frontText, `${latest.trimEnd()}\n\n![${result.name}](attachments/${result.sha256}--${result.name})\n`);
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
  // 模板选择块：仅空白种子期浮出；落了笔（dirtyTick）或已点选就不再打扰编辑。
  const showFormChooser = !isTableDoc && isConvertibleBlankDraft(item) && dirtyTick === 0 && !templatePicked;

  /** 形态选择（FR-TBL-9）：转换守卫在 setItemForm（仅空白期可切）。 */
  const pickTableForm = () => {
    setItemForm(userId, item.id, "table").catch((cause) => setSaveState({ kind: "error", message: String(cause) }));
  };
  /** 点选模板：先收起方块，普通笔记保持原样，多维表格切形态。 */
  const pickTemplate = (id: string) => {
    setTemplatePicked(true);
    if (id === "table") pickTableForm();
  };
  const switchToNoteForm = () => {
    setItemForm(userId, item.id, "note").catch((cause) => setSaveState({ kind: "error", message: String(cause) }));
  };
  const degradeDoc = () => {
    degradeTableToNote(userId, item.id).catch((cause) => setSaveState({ kind: "error", message: String(cause) }));
  };

  return (
    <article className="mn-doc" aria-label="文档区" data-form={isTableDoc ? "table" : "note"}>
      <DocBar
        crumb={crumb} showBack={showBack} onBack={onBack} mode={mode} onMode={switchMode}
        extra={(
          <>
            <button type="button" className="mn-iconbtn" aria-label="插入附件" title="上传并插入附件（20MB 内）" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              <Paperclip />
            </button>
            <button type="button" className="mn-iconbtn" aria-label="导出" title="导出 zip / Markdown" onClick={() => setExporting(true)}>
              <Download />
            </button>
            <button type="button" className="mn-iconbtn" aria-label="移入回收站" title="移入回收站" onClick={() => void softDeleteItem(userId, item.id)}>
              <Trash2 />
            </button>
            <span className="mn-docmore">
              <button type="button" className="mn-iconbtn" aria-label="更多" aria-expanded={moreOpen} title="更多" onClick={() => setMoreOpen((open) => !open)}>
                <MoreHorizontal />
              </button>
              {moreOpen && (
                <span className="mn-docmore-menu" role="menu">
                  <button type="button" role="menuitem" onClick={() => {
                    void navigator.clipboard.writeText(`${window.location.origin}${itemRoutePath(item.id)}`).then(() => {
                      setLinkCopied(true);
                      window.setTimeout(() => setLinkCopied(false), 2_000);
                    }).catch((cause) => setSaveState({ kind: "error", message: String(cause) }));
                  }}>
                    <Copy />{linkCopied ? "链接已复制" : "复制文档链接"}
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setEditorKind(editorKind === "source" ? "wysiwyg" : "source"); setMoreOpen(false); }}>
                    <Code />{editorKind === "source" ? "回到所见即所得" : "源码"}
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setHistory(true); setMoreOpen(false); }}>
                    <Clock />版本历史
                  </button>
                  {!isTableDoc && (
                    <button type="button" role="menuitem" onClick={() => { setAutoSummary(false); setAiMarkdown(latestFullMarkdown()); setAiAssist(true); setMoreOpen(false); }}>
                      <Sparkles />AI 助手
                    </button>
                  )}
                  <button type="button" role="menuitem" onClick={() => { setEncrypting(true); setMoreOpen(false); }}>
                    <Shield />启用单篇加密
                  </button>
                  {unfiled && (
                    <button type="button" role="menuitem" onClick={() => { setOrganizing(true); setMoreOpen(false); }}>
                      <FolderInput />整理到主题
                    </button>
                  )}
                </span>
              )}
            </span>
          </>
        )}
      />
      <div className="mn-docbody">
        <DocTitle
          key={item.id}
          value={title ?? item.title ?? ""}
          onChange={setTitle}
          onCommit={() => { if (title !== null) void flushTitle(title); }}
        />
        {conflictOf && (
          <p className="mn-conflictnote">
            <span>同步冲突副本：原条目与这份正文各有一版，保留哪一份由你决定。</span>
            <a href={itemRoutePath(conflictOf)}>打开原条目{conflictSource?.title ? `《${conflictSource.title}》` : ""}</a>
          </p>
        )}
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
        {showFormChooser && <TemplatePicker templates={TEMPLATES} onPick={pickTemplate} />}
        {plain && mode === "preview" && (
          <MarkdownView markdown={splitFrontmatter(draft ?? plain.markdown).body} className="md-body markdown-content mn-doc-preview" />
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
            onInput={() => setDirtyTick((n) => n + 1)}
            registerGetMarkdown={(get) => { getMarkdownRef.current = get; }}
            uploadFile={uploadAttachment}
            registerApplyExternal={(apply: ((markdown: string) => void) | null) => {
              if (apply) applyExternalRef.current = (markdown: string) => apply(splitFrontmatter(markdown).body);
              else applyExternalRef.current = null;
            }}
          />
        )}
      </div>
      <div className="mn-doc-foot">
        {/* 字数口径：正文改成「保存时取全量」后，这里显示的是**上次保存**的字符数，
            输入过程中不实时跳动——这是 FR-EDT-10 的有意取舍（省掉键入热路径上的整篇序列化）。 */}
        <span>{(draft ?? (item.content.scope === "plain" ? item.content.markdown : "")).length} 字符</span>
        <span className="mn-doc-foot-right">
          {saveState.kind === "saving" && "保存中…"}
          {saveState.kind === "error" && (
            <button type="button" className="mn-savestate err" onClick={() => { void flush(); }}>保存失败 · 重试</button>
          )}
          {saveState.kind === "idle" && "已保存"}
        </span>
      </div>
      {history && item && (
        <HistoryPanel userId={userId} itemId={item.id} currentMarkdown={draft ?? item.content.markdown} onClose={() => setHistory(false)} />
      )}
      {aiAssist && (
        <AiAssistDialog
          userId={userId}
          itemId={item.id}
          title={item.title ?? ""}
          tags={item.tags}
          markdown={aiMarkdown ?? (draft ?? item.content.markdown)}
          autoRun={autoSummary ? "summary" : undefined}
          onApplySummary={(next) => { void saveFullMarkdown(next); }}
          onApplyTags={async (recommended) => {
            const merged = [...item.tags, ...recommended.filter((tag) => !item.tags.includes(tag))];
            await saveItemMeta(userId, item.id, { tags: merged });
          }}
          onClose={() => { setAiAssist(false); setAutoSummary(false); }}
        />
      )}
      {encrypting && item && (
        <EncryptSetupDialog
          onCancel={() => setEncrypting(false)}
          onConfirm={async (password, code) => {
            const body = getMarkdownRef.current?.() ?? splitFrontmatter(draft ?? (item.content.scope === "plain" ? item.content.markdown : "")).body;
            const latest = joinFrontmatter(splitFrontmatter(draft ?? "").frontText, body);
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
            <div className="mn-dialog-head"><p className="mn-dialog-title">导出「{item.title}」</p></div>
            <div className="mn-dialog-body">
              {hasAttachmentRefs(item) && (
                <p className="mn-auth-hint">纯 Markdown 导出时附件引用会断链；zip 导出会随行附件目录。</p>
              )}
              {item.content.scope !== "plain" && (
                <p className="mn-auth-hint">已加密内容导出须先解锁（C-1：锁定态只能取得密文）。</p>
              )}
            </div>
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
