import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Clock, Code, Copy, Download, Eye, FileText, ListTree, MessageSquarePlus, MoreHorizontal, Paperclip, Pencil, Shield, Sparkles, Table2, Tag, Trash2, FolderInput, Focus, FilePlus2, X, Plus } from "lucide-react";
import type { Item, TopicNode } from "@menote/shared";
import { NoteEditor, OutlinePanel, type EditorKind } from "../editor";
import { MarkdownView } from "../markdown";
import { PropertyPanel } from "../props";
import { joinFrontmatter, readNoteMarginalia, splitFrontmatter, writeNoteMarginalia } from "../../lib/frontmatter";
import { newId } from "../../lib/hash";
import { TableDocument } from "../table";
import { AiAssistDialog } from "../ai";
import { useItem } from "../../services/contentHooks";
import { createNote, degradeTableToNote, isConvertibleBlankDraft, saveItemContent, saveItemMeta, setItemForm, softDeleteItem } from "../../services/contentService";
import { enableItemEncryption } from "../../services/encryptionCommandService";
import { listVersions, purgeItemsPermanently, type VersionRow } from "../../services/versionService";
import { exportNoteMarkdown, exportNoteZip, hasAttachmentRefs, uploadAttachment } from "../../services/attachmentService";
import { OrganizeDialog } from "./OrganizeDialog";
import { DocTitle } from "./DocTitle";
import { TemplatePicker, type TemplateOption } from "./TemplatePicker";
import { EncryptedNoteView } from "./EncryptedNoteView";
import { HistoryPanel } from "../versions";
import { EncryptSetupDialog } from "../encryption";
import { setSessionKey } from "../../services/keyringService";
import { itemRoutePath } from "../../app/appRoutes";
import { clipSourceFromMarkdown } from "../../lib/clipSource";
import { discardRecovery, openRecoveryMarkdown, readRecovery, scheduleRecovery, shouldOfferRecovery, writeRecovery } from "../../services/recoveryService";
import { DocSyncStatus } from "../sync";
import { ConflictCompare } from "./ConflictCompare";
import { getPropsPlacement, resolveToolbar, setPropsPlacement, subscribeDocLayout } from "../../lib/docLayout";

const AUTOSAVE_DEBOUNCE_MS = 800;

function formatDocumentDate(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(timestamp);
}

function formatDocumentUpdate(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (date.toDateString() === today.toDateString()) return `今天 ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`;
  return `${date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })} ${time}`;
}

/** 新文档可选模板（正文区正中浮出的小方块）。加模板就往这里续，渲染按一排五个的宽度排。 */
const TEMPLATES: TemplateOption[] = [
  { id: "note", name: "普通笔记", hint: "直接写正文，Markdown 原文", icon: <FileText size={16} /> },
  { id: "table", name: "多维表格", hint: "表格式整理，字段带类型", icon: <Table2 size={16} /> },
  { id: "import", name: "导入文档", hint: "将一个或多个 .md 文件拖到这里", icon: <FilePlus2 size={16} /> },
];

interface NoteDocumentProps {
  userId: string;
  noteId: string;
  topics: TopicNode[];
  onBack: () => void;
  showBack: boolean;
  crumb: string;
  /** 清单右键「AI 概述」：token 变化时打开对话框并开始生成。 */
  openSummaryToken?: number;
}

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "error"; message: string };

/** 文档区（FR-EDT-1/2 源码形态：编辑/预览两常驻模式；自动保存静默后台化，NFR-10）。 */
export function NoteDocument({ userId, noteId, topics, onBack, showBack, crumb, openSummaryToken }: NoteDocumentProps) {
  const item = useItem(userId, noteId);
  const [editorHost, setEditorHost] = useState<HTMLDivElement | null>(null);
  const outlineHostRef = useMemo(() => ({ current: editorHost }), [editorHost]);
  const [versionRows, setVersionRows] = useState<VersionRow[]>([]);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState("");
  const [annotationOpen, setAnnotationOpen] = useState(false);
  const [annotationId, setAnnotationId] = useState<string | null>(null);
  const [annotationDraft, setAnnotationDraft] = useState("");
  const [annotationError, setAnnotationError] = useState<string | null>(null);
  const documentRootRef = useRef<HTMLElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const inspectorCloseRef = useRef<HTMLButtonElement>(null);
  const readSelectedQuote = useCallback((target?: EventTarget | null): string => {
    if (target instanceof HTMLTextAreaElement) {
      return target.value.slice(target.selectionStart, target.selectionEnd).trim().slice(0, 4_000);
    }
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    const preview = documentRootRef.current?.querySelector(".mn-doc-preview");
    if (!selection || selection.isCollapsed || !node) return "";
    if (!editorHost?.contains(node) && !preview?.contains(node)) return "";
    return selection.toString().trim().slice(0, 4_000);
  }, [editorHost]);
  const captureSelectedQuote = useCallback((target?: EventTarget | null) => setSelectedQuote(readSelectedQuote(target)), [readSelectedQuote]);
  useEffect(() => {
    if (!item || item.type === "memo" || item.content.scope !== "plain") { setVersionRows([]); return; }
    let current = true;
    void listVersions(item.id).then((rows) => { if (current) setVersionRows(rows); });
    return () => { current = false; };
  }, [item?.id, item?.rev]);
  useEffect(() => {
    if (!inspectorOpen) return;
    const layout = document.querySelector<HTMLElement>(".mn-shell")?.dataset.layout;
    if (layout !== "compact" && layout !== "tablet" && layout !== "mobile") return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inspectorCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setInspectorOpen(false); return; }
      if (event.key !== "Tab") return;
      const nodes = inspectorRef.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
      if (!nodes?.length) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (previous?.isConnected) previous.focus();
    };
  }, [inspectorOpen]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "m") return;
      if (item?.type !== "note" || item.content.scope !== "plain") return;
      // 检查器（含批注输入框）里的选区不是正文：与鼠标路径同样排除，避免把批注文字抓成引述。
      if (event.target instanceof Element && event.target.closest(".mn-doc-inspector")) return;
      const quote = readSelectedQuote(event.target);
      if (!quote) return;
      event.preventDefault();
      setSelectedQuote(quote);
      setAnnotationError(null);
      setAnnotationId(newId());
      setAnnotationOpen(true);
      setInspectorOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [item, readSelectedQuote]);
  const latestItemRef = useRef(item);
  latestItemRef.current = item;
  // 冲突副本：记录它顶掉了哪一条目（G2 §5-2），文档区给出回溯入口供人工裁决。
  const conflictOf = item?.conflictOf ?? null;
  const conflictSource = useItem(userId, conflictOf);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [tableAddColumnSignal, setTableAddColumnSignal] = useState(0);
  const [editorKind, setEditorKind] = useState<EditorKind>("wysiwyg");
  const editorKindRef = useRef(editorKind);
  editorKindRef.current = editorKind;
  const [draft, setDraft] = useState<string | null>(null);
  // 脏计数：编辑器的 onInput 只是「正文变了」的信号，不带正文（FR-EDT-10）。
  // 用计数递增触发自动保存，正文在保存时从编辑器取全量。
  const [dirtyTick, setDirtyTick] = useState(0);
  const dirtyTickRef = useRef(dirtyTick);
  dirtyTickRef.current = dirtyTick;
  const [savedTick, setSavedTick] = useState(0);
  const [shortcutAck, setShortcutAck] = useState(false);
  // 模板选择块是否已被点选（点过就收起；直接开写也由 dirtyTick 收起）。
  const [templatePicked, setTemplatePicked] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [organizing, setOrganizing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [encrypting, setEncrypting] = useState(false);
  const [history, setHistory] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [recoveryText, setRecoveryText] = useState<string | null>(null);
  // 设置·外观：属性位置（顶部 / 页边注）与工具栏位置（顶部 / 底部浮动），随偏好即时切换。
  const [propsPos, setPropsPos] = useState(getPropsPlacement);
  const [toolbarPos, setToolbarPos] = useState(resolveToolbar);
  const [formatDock, setFormatDock] = useState<HTMLDivElement | null>(null);
  useEffect(() => subscribeDocLayout(() => {
    setPropsPos(getPropsPlacement());
    setToolbarPos(resolveToolbar());
  }), []);
  const [focusMode, setFocusMode] = useState(false);
  const [aiAssist, setAiAssist] = useState(false);
  const [autoSummary, setAutoSummary] = useState(false);
  useEffect(() => {
    if (!focusMode) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setFocusMode(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusMode]);
  // AI 面板用打开时的最新完整 Markdown；源码模式取完整 textarea，WYSIWYG 再拼回属性区。
  const [aiMarkdown, setAiMarkdown] = useState<string | null>(null);
  const latestFullMarkdown = (): string => {
    const base = draft ?? (item?.content.scope === "plain" ? item.content.markdown : "");
    const editorValue = getMarkdownRef.current?.();
    if (editorValue === undefined || editorValue === null) return base;
    return editorKindRef.current === "source"
      ? editorValue
      : joinFrontmatter(splitFrontmatter(base).frontText, editorValue);
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
  const saveFullMarkdown = useCallback(async (next: string): Promise<boolean> => {
    if (!item) return false;
    const savingTick = dirtyTickRef.current;
    setSaveState({ kind: "saving" });
    try {
      // WYSIWYG 正文以编辑器最新内容为准；源码模式的 next 已是完整原文。
      // 放在 try 内，序列化异常也能显示保存失败，不会让添加属性操作静默无效。
      const editorValue = getMarkdownRef.current?.();
      const value = editorValue === undefined || editorValue === null
        ? next
        : editorKind === "source"
          ? next
          : joinFrontmatter(splitFrontmatter(next).frontText, editorValue);
      setDraft(value);
      const saved = await saveItemContent(userId, item.id, value);
      const savedMarkdown = saved.content.scope === "plain" ? saved.content.markdown : "";
      setDraft(savedMarkdown);
      applyExternalRef.current?.(savedMarkdown);
      setSavedTick(savingTick);
      setSaveState({ kind: "idle" });
      return true;
    } catch (cause) {
      setSaveState({ kind: "error", message: String(cause) });
      return false;
    }
  }, [editorKind, item, userId]);

  const createMarginalia = async () => {
    const note = annotationDraft.trim();
    if (!note || !item || item.type !== "note") return;
    setAnnotationError(null);
    try {
      const markdown = latestFullMarkdown();
      const current = readNoteMarginalia(markdown);
      const id = annotationId ?? newId();
      const next = writeNoteMarginalia(markdown, [...current.filter((row) => row.id !== id), { id, quote: selectedQuote, note, createdAt: Date.now() }]);
      if (!await saveFullMarkdown(next)) throw new Error("save_failed");
      setAnnotationDraft("");
      setAnnotationOpen(false);
      setAnnotationId(null);
      setSelectedQuote("");
    } catch {
      setAnnotationError("页边注保存失败，请重试。");
    }
  };

  const removeMarginalia = async (id: string) => {
    if (!item || item.type !== "note") return;
    try {
      const markdown = latestFullMarkdown();
      const next = writeNoteMarginalia(markdown, readNoteMarginalia(markdown).filter((annotation) => annotation.id !== id));
      if (!await saveFullMarkdown(next)) throw new Error("save_failed");
    } catch {
      setAnnotationError("页边注删除失败，请重试。");
    }
  };

  // noteId 变化时初始化（父组件以 key 重挂载，这里兜底异步到达）。
  useEffect(() => {
    if (item && draft === null) setDraft(item.content.scope === "plain" ? item.content.markdown : "");
    if (item && title === null) setTitle(item.title);
  }, [item, draft, title]);

  // 兼容曾落库为空正文的旧表格草稿；按当前默认值补成一列一行。
  useEffect(() => {
    if (!item || item.type !== "table" || !isConvertibleBlankDraft(item)) return;
    let cancelled = false;
    void setItemForm(userId, item.id, "table").then((seeded) => {
      if (cancelled) return;
      setDraft(seeded.content.scope === "plain" ? seeded.content.markdown : "");
      setSavedTick(dirtyTickRef.current);
      setSaveState({ kind: "idle" });
    }).catch((cause) => {
      if (!cancelled) setSaveState({ kind: "error", message: String(cause) });
    });
    return () => { cancelled = true; };
  }, [userId, item?.id, item?.type, item?.rev, item?.metaRev]);

  const flush = useCallback(async (overrideMarkdown?: string) => {
    if (!item || item.content.scope !== "plain") return false;
    const savingTick = dirtyTickRef.current;
    // WYSIWYG 只处理正文，由属性区管理 YAML；源码模式直接保存完整 Markdown。
    const currentFull = draft ?? item.content.markdown;
    const editorValue = overrideMarkdown ?? getMarkdownRef.current?.() ?? null;
    const { frontText } = splitFrontmatter(currentFull);
    const value = editorValue === null
      ? currentFull
      : editorKind === "source"
        ? editorValue
        : joinFrontmatter(frontText, editorValue);
    if (value === null || value === item.content.markdown) {
      setSavedTick(savingTick);
      setSaveState({ kind: "idle" });
      return true;
    }
    setSaveState({ kind: "saving" });
    try {
      const saved = await saveItemContent(userId, item.id, value);
      setDraft(saved.content.scope === "plain" ? saved.content.markdown : "");
      setSavedTick(savingTick);
      setSaveState({ kind: "idle" });
      return true;
    } catch (cause) {
      setSaveState({ kind: "error", message: String(cause) });
      return false;
    }
  }, [draft, editorKind, item, userId]);

  // 自动保存防抖（键入不停顿不打断；失败有可见但不阻断的提示与重试）。
  // 依赖脏计数而不是正文：键入路径不再整篇序列化，flush 时才从编辑器取全量（FR-EDT-10）。
  const plainMarkdown = item?.content.scope === "plain" ? item.content.markdown : "";
  // 页边注与字数统计随 draft 缓存：键入只递增 dirtyTick，不再每次重渲染都全量解析 YAML。
  const docSplit = useMemo(() => splitFrontmatter(draft ?? plainMarkdown), [draft, plainMarkdown]);
  const docMarginalia = useMemo(
    () => (item?.type === "note" ? readNoteMarginalia(draft ?? plainMarkdown) : []),
    [item?.type, draft, plainMarkdown],
  );
  const clipSource = clipSourceFromMarkdown(draft ?? plainMarkdown);

  useEffect(() => {
    if (!item || item.content.scope !== "plain") { setRecoveryText(null); return; }
    let cancelled = false;
    void readRecovery(item.id).then(async (row) => {
      if (cancelled || !row) return setRecoveryText(null);
      const text = await openRecoveryMarkdown(row);
      if (!cancelled) setRecoveryText(shouldOfferRecovery(item.content.scope === "plain" ? item.content.markdown : "", text) ? text : null);
    });
    return () => { cancelled = true; };
  }, [item]);

  useEffect(() => {
    if (!item || item.content.scope !== "plain" || dirtyTick <= savedTick) return;
    const editorValue = getMarkdownRef.current?.();
    if (editorValue == null) return;
    const value = editorKindRef.current === "source"
      ? editorValue
      : joinFrontmatter(splitFrontmatter(item.content.markdown).frontText, editorValue);
    scheduleRecovery(userId, item.id, value, "plain");
  }, [dirtyTick, savedTick, item, userId]);

  useEffect(() => {
    const flushSnapshot = () => {
      const current = latestItemRef.current;
      const editorValue = getMarkdownRef.current?.();
      if (!current || editorValue == null || current.content.scope !== "plain") return;
      const value = editorKindRef.current === "source"
        ? editorValue
        : joinFrontmatter(splitFrontmatter(current.content.markdown).frontText, editorValue);
      if (value !== current.content.markdown) void writeRecovery(userId, current.id, value, "plain");
    };
    window.addEventListener("pagehide", flushSnapshot);
    return () => window.removeEventListener("pagehide", flushSnapshot);
  }, [userId]);

  useEffect(() => {
    if (draft === null || !item || dirtyTick <= savedTick) return;
    // 旧版/异常空表格由下面的修复 effect 补种子；不要用切换前的空 draft 把它再写空。
    if (item.type === "table" && isConvertibleBlankDraft(item)) return;
    const timer = setTimeout(() => { void flush(); }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [dirtyTick, savedTick, flush, item]);

  // 卸载前尽力落盘（异步保存不阻塞返回；失败保留本地草稿，本地库本就是权威）。
  // WYSIWYG 只持有正文，需要拼回 frontmatter；源码模式已持有完整 Markdown。
  useEffect(() => () => {
    const currentItem = latestItemRef.current;
    const editorValue = getMarkdownRef.current?.();
    if (!currentItem || editorValue === null || editorValue === undefined || currentItem.content.scope !== "plain") return;
    const value = editorKindRef.current === "source"
      ? editorValue
      : joinFrontmatter(splitFrontmatter(currentItem.content.markdown).frontText, editorValue);
    if (value !== currentItem.content.markdown) void saveItemContent(userId, currentItem.id, value).catch(() => {});
  }, [noteId, userId]);

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
        setSaveState({ kind: "saving" });
        void flush().then((saved) => {
          if (saved) {
            setShortcutAck(true);
            window.setTimeout(() => setShortcutAck(false), 1_500);
          }
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flush]);

  const switchMode = async (next: "edit" | "preview") => {
    if (next === "preview") await flush();
    setMode(next);
  };

  const toggleEditorKind = async () => {
    if (!(await flush())) return;
    setEditorKind((current) => current === "source" ? "wysiwyg" : "source");
    setMoreOpen(false);
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
      const result = await uploadAttachment(userId, file);
      if ("error" in result) {
        setSaveState({ kind: "error", message: result.error });
        return;
      }
      const current = draft ?? (item.content.scope === "plain" ? item.content.markdown : "");
      const editorValue = getMarkdownRef.current?.();
      const full = editorKind === "source"
        ? editorValue ?? current
        : joinFrontmatter(splitFrontmatter(current).frontText, editorValue ?? splitFrontmatter(current).body);
      const { frontText, body } = splitFrontmatter(full);
      const next = joinFrontmatter(frontText, `${body.trimEnd()}\n\n![${result.name}](attachments/${result.sha256}--${result.name})\n`);
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
  const marginalia = docMarginalia;
  const contentCharacters = docSplit.body.length;
  const itemPlace = item.topicId ? topics.find((row) => row.id === item.topicId)?.name : item.source === "manual" ? "草稿箱" : "收件箱";
  const groupPlace = item.groupId ? topics.find((row) => row.id === item.groupId)?.name : null;
  const documentCrumb = [itemPlace || crumb, groupPlace, title ?? item.title].filter(Boolean).join(" / ");
  // 模板选择块：仅空白种子期浮出；落了笔（dirtyTick）或已点选就不再打扰编辑。
  const showFormChooser = !isTableDoc && isConvertibleBlankDraft(item) && dirtyTick === 0 && !templatePicked;

  /** 形态选择（FR-TBL-9）：转换守卫在 setItemForm（仅空白期可切）。 */
  const pickTableForm = () => {
    void setItemForm(userId, item.id, "table").then((converted) => {
      setDraft(converted.content.scope === "plain" ? converted.content.markdown : "");
      setSavedTick(dirtyTickRef.current);
      setSaveState({ kind: "idle" });
    }).catch((cause) => setSaveState({ kind: "error", message: String(cause) }));
  };
  /** 点选模板：先收起方块，普通笔记保持原样，多维表格切形态。 */
  const pickTemplate = (id: string) => {
    if (id === "import") {
      setImportMessage("将一个或多个 .md 文件拖到此入口即可导入");
      return;
    }
    setTemplatePicked(true);
    if (id === "table") pickTableForm();
  };
  const importMarkdownFiles = async (files: File[]) => {
    const markdownFiles = files.filter((file) => /\.md$/i.test(file.name));
    if (!markdownFiles.length) {
      setImportMessage("请拖入 .md Markdown 文件");
      return;
    }
    setImporting(true);
    setTemplatePicked(true);
    setSaveState({ kind: "saving" });
    try {
      for (let index = 0; index < markdownFiles.length; index += 1) {
        const file = markdownFiles[index]!;
        const content = await file.text();
        const title = file.name.replace(/\.md$/i, "").trim() || "无标题";
        const target = index === 0
          ? item
          : await createNote(userId, { title, topicId: item.topicId, groupId: item.groupId });
        if (index === 0) {
          await saveItemMeta(userId, target.id, { title });
          setTitle(title);
        }
        await saveItemContent(userId, target.id, content);
        if (index === 0) {
          // Keep the local draft in step with the imported item. An initialized empty draft
          // otherwise wins over plain.markdown in the property panel and hides its frontmatter.
          setDraft(content);
          setSavedTick(dirtyTickRef.current);
        }
      }
      const rejected = files.length - markdownFiles.length;
      setImportMessage(`已导入 ${markdownFiles.length} 篇 Markdown 笔记${rejected ? `，已跳过 ${rejected} 个非 .md 文件` : ""}`);
      setSaveState({ kind: "idle" });
    } catch (cause) {
      setSaveState({ kind: "error", message: `导入失败：${String(cause)}` });
    } finally {
      setImporting(false);
    }
  };
  const switchToNoteForm = () => {
    void setItemForm(userId, item.id, "note").then((converted) => {
      setDraft(converted.content.scope === "plain" ? converted.content.markdown : "");
      setSavedTick(dirtyTickRef.current);
      setSaveState({ kind: "idle" });
    }).catch((cause) => setSaveState({ kind: "error", message: String(cause) }));
  };
  const degradeDoc = () => {
    degradeTableToNote(userId, item.id).catch((cause) => setSaveState({ kind: "error", message: String(cause) }));
  };

  return (
    <article ref={documentRootRef} className="mn-doc" aria-label="文档区" data-form={isTableDoc ? "table" : "note"} data-mode={mode} data-focus={focusMode || undefined} data-inspector-open={inspectorOpen || undefined}
      onMouseUpCapture={(event) => { if (!(event.target instanceof Element) || !event.target.closest(".mn-doc-inspector")) captureSelectedQuote(event.target); }}
      onSelectCapture={(event) => { if (!(event.target instanceof Element) || !event.target.closest(".mn-doc-inspector")) captureSelectedQuote(event.target); }}
      onKeyUpCapture={(event) => { if (event.target instanceof Element && event.target.closest(".mn-editor-host")) captureSelectedQuote(event.target); }}>
      <DocBar
        crumb={documentCrumb} showBack={showBack} onBack={onBack} mode={mode} onMode={switchMode}
        extra={(
          <>
            <DocSyncStatus userId={userId} itemId={item.id} saving={saveState.kind === "saving"} dirty={dirtyTick > savedTick} saveError={saveState.kind === "error"} onRetrySave={() => { void flush(); }} />
            {isTableDoc && mode === "edit" && <button type="button" className="mn-iconbtn" aria-label="添加字段" title="添加字段" onClick={() => setTableAddColumnSignal((value) => value + 1)}><Plus aria-hidden="true" /></button>}
            {!isTableDoc && <button type="button" className="mn-iconbtn mn-doc-inspector-toggle" aria-label={inspectorOpen ? "关闭文档检查器" : "打开文档检查器"} title="文档检查器" aria-expanded={inspectorOpen} aria-controls="mn-doc-inspector" onClick={() => setInspectorOpen((open) => !open)}><ListTree aria-hidden="true" /></button>}
            {!isTableDoc && <button type="button" className="mn-iconbtn" aria-label={focusMode ? "退出专注模式" : "专注模式"} title={focusMode ? "退出专注模式（Esc）" : "专注模式"} aria-pressed={focusMode} onClick={() => setFocusMode((value) => !value)}><Focus /></button>}
            {!isTableDoc && <button type="button" className="mn-iconbtn" aria-label="插入附件" title="按附件设置上传并插入文件" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              <Paperclip />
            </button>}
            {!isTableDoc && <button type="button" className="mn-iconbtn" aria-label="导出" title="导出 zip / Markdown" onClick={() => setExporting(true)}>
              <Download />
            </button>}
            {!isTableDoc && <button type="button" className="mn-iconbtn" aria-label="移入回收站" title="移入回收站" onClick={() => void softDeleteItem(userId, item.id)}>
              <Trash2 />
            </button>}
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
                  {isTableDoc && <button type="button" role="menuitem" onClick={() => { setFocusMode((value) => !value); setMoreOpen(false); }}><Focus />{focusMode ? "退出专注模式" : "专注模式"}</button>}
                  {isTableDoc && <button type="button" role="menuitem" disabled={uploading} onClick={() => { setMoreOpen(false); fileInputRef.current?.click(); }}><Paperclip />插入附件</button>}
                  {isTableDoc && <button type="button" role="menuitem" onClick={() => { setExporting(true); setMoreOpen(false); }}><Download />导出</button>}
                  {isTableDoc && <button type="button" role="menuitem" onClick={() => void softDeleteItem(userId, item.id)}><Trash2 />移入回收站</button>}
                  <button type="button" role="menuitem" onClick={() => void toggleEditorKind()}>
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
                  <button type="button" role="menuitem" onClick={() => { setOrganizing(true); setMoreOpen(false); }}>
                    <FolderInput />修改存放路径
                  </button>
                </span>
              )}
            </span>
          </>
        )}
      />
      <div className="mn-docbody">
        <div className="mn-doc-main">
        {clipSource && (
          <p className="mn-clip-source">
            <span>剪藏自 {clipSource.host}</span>
            <a href={clipSource.url} target="_blank" rel="noreferrer">打开原网页</a>
            <button type="button" className="mn-textbtn" onClick={() => void navigator.clipboard.writeText(clipSource.url)}>复制原链接</button>
          </p>
        )}
        {recoveryText && (
          <p className="mn-conflictnote">
            <span>发现未保存的恢复副本。异常退出前的正文还在本机，没有上传。</span>
            <button type="button" className="mn-textbtn" onClick={() => { void saveItemContent(userId, item.id, recoveryText); setRecoveryText(null); }}>恢复</button>
            <button type="button" className="mn-textbtn" onClick={() => { void discardRecovery(item.id); setRecoveryText(null); }}>丢弃</button>
          </p>
        )}
        {!isTableDoc && <div className="mn-doc-kicker"><span>NOTE</span><i aria-hidden="true" />{item.topicId === null && <b>{item.source === "manual" ? "草稿" : "收件箱"}</b>}</div>}
        <DocTitle
          key={item.id}
          value={title ?? item.title ?? ""}
          onChange={setTitle}
          onCommit={() => { if (title !== null) void flushTitle(title); }}
        />
        {!isTableDoc && <div className="mn-doc-meta" aria-label="文档信息">
          <time dateTime={new Date(item.createdAt).toISOString()}>{formatDocumentDate(item.createdAt)}</time>
          <span aria-hidden="true">·</span>
          <span>更新于 {formatDocumentUpdate(item.updatedAt)}</span>
          <span aria-hidden="true">·</span>
          <span>{contentCharacters.toLocaleString("zh-CN")} 字符</span>
        </div>}
        {conflictOf && item.content.scope === "plain" && (
          <ConflictCompare userId={userId} copy={item} original={conflictSource} copyText={draft ?? item.content.markdown} onKeptOriginal={onBack} />
        )}
        {plain && propsPos === "top" && (
          <PropertyPanel
            userId={userId}
            markdown={draft ?? plain.markdown}
            onSave={saveFullMarkdown}
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
          {showFormChooser && <TemplatePicker templates={TEMPLATES} onPick={pickTemplate} onDropFiles={(files) => void importMarkdownFiles(files)} />}
          {(importing || importMessage) && <p className="mn-import-feedback" role="status">{importing ? "正在导入 Markdown 文档…" : importMessage}</p>}
        {plain && mode === "preview" && !isTableDoc && (
          <MarkdownView markdown={splitFrontmatter(draft ?? plain.markdown).body} className="md-body markdown-content mn-doc-preview" />
        )}
        {plain && isTableDoc && (
          <TableDocument
            userId={userId}
            itemId={item.id}
            markdown={draft ?? plain.markdown}
            onChangeMarkdown={(next) => void saveFullMarkdown(next)}
            onDegrade={degradeDoc}
            onSwitchToNote={switchToNoteForm}
            readOnly={mode === "preview"}
            addColumnSignal={tableAddColumnSignal}
          />
        )}
        {plain && mode === "edit" && !isTableDoc && (
          <NoteEditor
            mode="edit"
            kind={editorKind}
            formatDock={formatDock}
            externalMarkdown={editorKind === "source"
              ? draft ?? plain.markdown
              : splitFrontmatter(draft ?? plain.markdown).body}
            onInput={() => setDirtyTick((n) => n + 1)}
            registerGetMarkdown={(get) => { getMarkdownRef.current = get; }}
            uploadFile={(file, onProgress) => uploadAttachment(userId, file, onProgress)}
            inspectorOutline
            onHostElement={setEditorHost}
            registerApplyExternal={(apply: ((markdown: string) => void) | null) => {
              if (apply) applyExternalRef.current = (markdown: string) => apply(
                editorKind === "source" ? markdown : splitFrontmatter(markdown).body,
              );
              else applyExternalRef.current = null;
            }}
          />
        )}
        </div>
        {!isTableDoc && <>
          <button type="button" className="mn-doc-inspector-backdrop" aria-label="关闭文档检查器" onClick={() => setInspectorOpen(false)} />
          <aside ref={inspectorRef} id="mn-doc-inspector" className="mn-doc-inspector" aria-label="文档检查器" data-open={inspectorOpen || undefined}>
            <header className="mn-inspector-mobile-head"><strong>文档检查器</strong><button ref={inspectorCloseRef} type="button" className="mn-iconbtn" aria-label="关闭检查器" onClick={() => setInspectorOpen(false)}><X aria-hidden="true" /></button></header>
            {propsPos === "side" && <section className="mn-inspector-section mn-inspector-properties" aria-label="属性">
              <header className="mn-inspector-section-head"><h2>属性</h2><button type="button" className="mn-textbtn" onClick={() => setPropsPlacement("top")}>移至顶部</button></header>
              <PropertyPanel userId={userId} markdown={draft ?? plain.markdown} onSave={saveFullMarkdown} />
            </section>}
            <OutlinePanel hostRef={outlineHostRef} kind={editorKind} variant="inspector" markdown={mode === "preview" ? splitFrontmatter(draft ?? plain.markdown).body : undefined} />
            <section className="mn-inspector-section mn-inspector-marginalia" aria-label="页边注">
              <header className="mn-inspector-section-head"><h2>页边注</h2><span>{marginalia.length} 条</span></header>
              {marginalia.map((annotation) => <article className="mn-marginalia-card" key={annotation.id}>
                {annotation.quote && <blockquote><mark>{annotation.quote}</mark></blockquote>}
                <p>{annotation.note}</p>
                <footer><time dateTime={new Date(annotation.createdAt).toISOString()}>{formatDocumentUpdate(annotation.createdAt)}</time><button type="button" className="mn-iconbtn" aria-label="删除页边注" title="删除页边注" onClick={() => void removeMarginalia(annotation.id)}><Trash2 aria-hidden="true" /></button></footer>
              </article>)}
              {annotationOpen ? <form className="mn-inspector-annotation-form" onSubmit={(event) => { event.preventDefault(); void createMarginalia(); }}>
                <blockquote><mark>{selectedQuote}</mark></blockquote>
                <textarea autoFocus value={annotationDraft} onChange={(event) => setAnnotationDraft(event.target.value)} aria-label="页边注内容" placeholder="写下这段文字的批注…" maxLength={4_000} />
                {annotationError && <p role="alert">{annotationError}</p>}
                <div><button type="button" className="mn-textbtn" onClick={() => { setAnnotationOpen(false); setAnnotationDraft(""); setAnnotationId(null); setAnnotationError(null); }}>取消</button><button type="submit" className="mn-textbtn" disabled={!annotationDraft.trim()}>保存批注</button></div>
              </form> : <button type="button" className="mn-inspector-add-annotation" disabled={!selectedQuote} title={selectedQuote ? "添加页边注" : "选中正文后添加页边注"} onClick={() => { setAnnotationId(newId()); setAnnotationError(null); setAnnotationOpen(true); }}><MessageSquarePlus aria-hidden="true" />新建页边注 · 选中文字后按 ⌥⌘M</button>}
            </section>
            <section className="mn-inspector-section mn-inspector-versions" aria-label="版本">
              <header className="mn-inspector-section-head"><h2>版本</h2><button type="button" className="mn-textbtn" onClick={() => setHistory(true)}>全部</button></header>
              {versionRows.length === 0 ? <p className="mn-outline-empty">保存后会在这里保留版本记录</p> : versionRows.slice(0, 3).map((version) => <button type="button" className="mn-inspector-version" key={version.id} onClick={() => setHistory(true)}>
                <time dateTime={new Date(version.createdAt).toISOString()}>{formatDocumentUpdate(version.createdAt)}</time><span>{version.reason === "manual" ? "手动保存" : version.reason === "restore" ? "恢复前存档" : version.reason === "session" ? "会话存档" : "自动保存"}</span>
              </button>)}
            </section>
          </aside>
        </>}
      </div>
      {toolbarPos === "bottom" && mode === "edit" && editorKind === "wysiwyg" && !isTableDoc && (
        <div className="mn-formatdock" ref={setFormatDock} role="presentation" />
      )}
      <div className="mn-doc-foot">
        {/* 字数口径：正文改成「保存时取全量」后，这里显示的是**上次保存**的字符数，
            输入过程中不实时跳动——这是 FR-EDT-10 的有意取舍（省掉键入热路径上的整篇序列化）。 */}
        <span>{(isTableDoc ? (draft ?? plain.markdown).length : contentCharacters).toLocaleString("zh-CN")} 字符</span>
        <span className="mn-doc-foot-right">{shortcutAck ? "已用 Ctrl+S 保存" : ""}</span>
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
            const current = draft ?? (item.content.scope === "plain" ? item.content.markdown : "");
            const editorValue = getMarkdownRef.current?.();
            const latest = editorValue === undefined || editorValue === null
              ? current
              : editorKind === "source"
                ? editorValue
                : joinFrontmatter(splitFrontmatter(current).frontText, editorValue);
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
          item={item} topics={topics} onDone={() => { setOrganizing(false); }}
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
