import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { normalizeCellValue, splitMultiCell } from "../../lib/gfmTable";
import type { PropertyDef, PropertyType } from "../../lib/frontmatter";
import { safeWebUrl } from "../../lib/safeUrl";
import { ArrowUpRight, Link, Paperclip, Pencil, X } from "../../icons";
import { extractAttachmentRefs } from "../../lib/attachmentRefs";
import { attachmentUrl, fetchAttachmentBlob, uploadAttachment } from "../../services/attachmentService";
import { readAttachmentPolicy } from "../../services/attachmentPolicyService";
import { uploadSealedAttachment } from "../../services/sealedAttachmentService";
import { ChoicePills, TableChoiceCell } from "./TableChoiceCell";
import { TableDateCell } from "./TableDateCell";
import { UnlockedAttachment } from "../attachments";

interface TableCellEditorProps {
  userId?: string;
  allowAttachments?: boolean;
  attachmentItemId?: string;
  value: string;
  type: PropertyType;
  /** 字段定义（候选值来源）；无定义的列由调用方按 text 分派（FR-TBL-4/5）。 */
  def?: PropertyDef;
  onChange: (value: string, newOption?: string) => void;
  /** 预览态：只呈现内容，不接受任何输入（FR-TBL-20）。 */
  readOnly?: boolean;
  /** 该列开启自动换行：文本类单元格换成多行控件，行高随内容长高。 */
  wrap?: boolean;
  showCover?: boolean;
}

/** 类型化单元格控件（FR-TBL-7）：表格文档与 Note 内表格弹窗（双轨 FR-TBL-2）共用。
 *  写回契约见 lib/gfmTable（FR-TBL-6）；历史值不静默修正，编辑时才按类型覆盖（FR-TBL-4 精神）。 */
export function TableCellEditor({ userId, allowAttachments = true, attachmentItemId, value, type, def, onChange, readOnly = false, wrap = false, showCover = false }: TableCellEditorProps) {
  if (showCover && type === "link") {
    const href = safeWebUrl(value);
    if (readOnly && href) return <CoverThumbnail key={href} href={href} />;
    if (!readOnly) return <CellEditorShell value={value} onRestore={onChange}>
      <CoverLinkEditor href={href} value={value} onChange={onChange} wrap={wrap} />
    </CellEditorShell>;
  }
  if (readOnly) return <CellContent value={value} type={type} def={def} wrap={wrap} attachmentItemId={attachmentItemId} />;
  let editor: ReactNode;
  if (type === "attachment") {
    editor = allowAttachments && userId
      ? <AttachmentCell userId={userId} value={value} onChange={onChange} attachmentItemId={attachmentItemId} />
      : <AttachmentList value={value} attachmentItemId={attachmentItemId} />;
  } else if (type === "checkbox") {
    editor = <CheckboxCell value={value} onChange={onChange} />;
  } else if (type === "select" || type === "multiselect") {
    return <TableChoiceCell value={value} def={def} multi={type === "multiselect"} onChange={onChange} />;
  } else if (type === "date" || type === "datetime") {
    return <TableDateCell value={value} dateTime={type === "datetime"} onChange={onChange} />;
  } else if (type === "link") {
    editor = <div className="mn-tcell-url"><OpenUrl value={value} /><TextCell value={value} onChange={onChange} wrap={wrap} aria-label="链接单元格" /></div>;
  } else {
    editor = <TextCell value={value} onChange={onChange} wrap={wrap} aria-label={type === "number" ? "数字单元格" : "单元格"} numeric={type === "number"} />;
  }
  return <CellEditorShell value={value} onRestore={onChange}>{editor}</CellEditorShell>;
}

/** 文本类单元格：默认单行输入（与历史行为一致），列开启换行时改用自增高多行控件。 */
function TextCell({ value, onChange, wrap, numeric, autoFocus, "aria-label": ariaLabel }: {
  value: string; onChange: (value: string) => void; wrap: boolean; numeric?: boolean; autoFocus?: boolean; "aria-label": string;
}) {
  // 保存仍逐键进行，保留正在输入的末尾空格；外部粘贴或撤销改值后立即采用新值。
  const [draft, setDraft] = useState<string | null>(null);
  const displayed = draft !== null && normalizeCellValue(draft) === value ? draft : value;
  const change = (next: string) => { setDraft(next); onChange(normalizeCellValue(next)); };
  const legacyNumber = numeric && value !== "" && !/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value);
  if (!wrap || numeric) return <input className="mn-tcell-input" data-numeric={numeric || undefined}
    type={numeric && !legacyNumber ? "number" : "text"} step={numeric ? "any" : undefined}
    size={Math.max(12, Math.min(80, value.length || 12))} value={displayed} title={value} aria-label={ariaLabel}
    autoFocus={autoFocus} onChange={event => change(event.target.value)} onBlur={() => setDraft(null)} />;
  return <GrowingTextarea value={displayed} ariaLabel={ariaLabel} autoFocus={autoFocus} onChange={change} onCommit={() => setDraft(null)} />;
}

function OpenUrl({ value }: { value: string }) {
  const href = safeWebUrl(value);
  return href ? <a className="mn-tcell-open" href={href} target="_blank" rel="noopener noreferrer"
    aria-label={"打开链接：" + value} title="在新标签页打开链接"><ArrowUpRight aria-hidden="true" /></a>
    : <span className="mn-tcell-url-hint" aria-hidden="true"><Link /></span>;
}

function CoverThumbnail({ href }: { href: string }) {
  const [failed, setFailed] = useState(false);
  return <a className="mn-tcell-open mn-tcell-cover-thumb" href={href} target="_blank" rel="noopener noreferrer"
    aria-label={failed ? "打开封面链接" : "打开封面原图"} title={failed ? "封面无法加载，打开链接" : "打开封面原图"}>
    {failed ? <ArrowUpRight aria-hidden="true" /> : <img src={href} alt="" loading="lazy" decoding="async"
      referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
  </a>;
}

function CoverLinkEditor({ href, value, onChange, wrap }: {
  href: string | null; value: string; onChange: (value: string) => void; wrap: boolean;
}) {
  const [editing, setEditing] = useState(false);
  if (href && !editing) return <div className="mn-tcell-url">
    <CoverThumbnail key={href} href={href} />
    <button type="button" className="mn-tcell-cover-edit" aria-label="编辑封面链接" title="编辑封面链接"
      onClick={() => setEditing(true)}><Pencil aria-hidden="true" /></button>
  </div>;

  return <div className="mn-tcell-url" data-editing-cover={editing || undefined} onFocus={() => setEditing(true)}
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setEditing(false);
    }}>
    <OpenUrl value={value} />
    <TextCell value={value} onChange={onChange} wrap={wrap} autoFocus={editing} aria-label="封面链接" />
  </div>;
}

/** 自增高多行输入：高度跟着内容走，行高随之长高（换行列的「显示全部内容」语义）。 */
function GrowingTextarea({ value, onChange, onCommit, ariaLabel, autoFocus }: {
  value: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  ariaLabel: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const element = ref.current;
    if (!element) return;
    // 先清除旧高度，再按当前列宽和内容重新测量，避免旧的行高继续撑大单元格。
    element.style.height = "0px";
    // 离屏行量不到高度时恢复 CSS 兜底高度，不要把控件压成 0。
    if (element.scrollHeight > 0) element.style.height = `${element.scrollHeight}px`;
    else element.style.height = "";
  };
  useLayoutEffect(fit, [value]);
  useEffect(() => {
    const element = ref.current;
    if (element && typeof ResizeObserver !== "undefined") {
      let width: number | undefined;
      const observer = new ResizeObserver((entries) => {
        const nextWidth = entries[0]?.contentRect.width;
        if (nextWidth === undefined || nextWidth === width) return;
        width = nextWidth;
        fit();
      });
      observer.observe(element);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <textarea ref={ref} className="mn-tcell-textarea" rows={1} value={value} aria-label={ariaLabel} title={value} autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)} onBlur={(e) => onCommit(e.currentTarget.value)} />
  );
}

function CellEditorShell({ value, onRestore, children }: { value: string; onRestore: (value: string) => void; children: ReactNode }) {
  const original = useRef(value);
  const focused = useRef(false);
  const onFocus = (_event: FocusEvent<HTMLDivElement>) => {
    if (focused.current) return;
    original.current = value;
    focused.current = true;
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    focused.current = false;
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    onRestore(original.current);
    (event.target as HTMLElement).blur();
  };
  return <div className="mn-tcell-editor" onFocus={onFocus} onBlur={onBlur} onKeyDown={onKeyDown}>{children}</div>;
}

/** 预览态只读呈现：与编辑态共用类型与色调，但没有任何可输入控件（FR-TBL-20）。 */
export function CellContent({ value, type, def, wrap, attachmentItemId }: { value: string; type: PropertyType; def?: PropertyDef; wrap: boolean; attachmentItemId?: string }) {
  if (type === "attachment") return <AttachmentList value={value} attachmentItemId={attachmentItemId} />;
  if (type === "checkbox") {
    return (
      <span className="mn-tcell-checkwrap">
        <span className={`mn-tcell-checkmark${value === "true" ? " on" : ""}`} role="img" aria-label={value === "true" ? "已勾选" : "未勾选"}>{value === "true" ? "✓" : ""}</span>
        {value !== "true" && value !== "false" && value !== "" && <span className="mn-tcell-legacy">{value}</span>}
      </span>
    );
  }
  if (type === "select" || type === "multiselect") return <ChoicePills def={def} multi={type === "multiselect"}
    values={type === "select" ? (value ? [value] : []) : [...new Set(splitMultiCell(value))]} />;
  if (type === "date" || type === "datetime") return <TableDateCell value={value} dateTime={type === "datetime"} />;
  if (type === "number") return <span className="mn-tcell-text mn-tcell-number" title={value}>{value || "—"}</span>;
  if (type === "link") {
    const href = safeWebUrl(value);
    return <span className="mn-tcell-url"><OpenUrl value={value} />{href
      ? <a className="mn-tcell-text mn-tcell-link" href={href} data-wrap={wrap} target="_blank" rel="noopener noreferrer" title={value}>{value}</a>
      : <span className="mn-tcell-text" data-wrap={wrap}>{value || "—"}</span>}</span>;
  }
  return <span className="mn-tcell-text" data-wrap={wrap ? "true" : "false"} title={value}>{value || "—"}</span>;
}

const IMAGE_ATTACHMENT = /\.(?:avif|bmp|gif|jpe?g|png|webp)$/i;
const THUMBNAIL_MAX_EDGE = 96;
const THUMBNAIL_CACHE_LIMIT = 256;
const thumbnailCache = new Map<string, string>();

function rememberThumbnail(sha256: string, dataUrl: string): void {
  if (thumbnailCache.has(sha256)) thumbnailCache.delete(sha256);
  thumbnailCache.set(sha256, dataUrl);
  if (thumbnailCache.size > THUMBNAIL_CACHE_LIMIT) {
    const first = thumbnailCache.keys().next().value;
    if (first) thumbnailCache.delete(first);
  }
}

function AttachmentList({ value, attachmentItemId }: { value: string; attachmentItemId?: string }) {
  const refs = extractAttachmentRefs(value);
  const [preview, setPreview] = useState<(typeof refs)[number] | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!preview) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setPreview(null);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      if (previous?.isConnected) previous.focus();
    };
  }, [preview]);
  if (!refs.length) return <span className="mn-tcell-attachment-empty" title={value}>{value || "无附件"}</span>;
  if (attachmentItemId) return <span className="mn-tcell-attachments">{refs.map((ref, index) =>
    <span className="mn-tcell-attachment" key={`${ref.sha256}-${index}`}>
      <UnlockedAttachment itemId={attachmentItemId} {...ref} />
    </span>)}</span>;
  return (
    <>
      <span className="mn-tcell-attachments">{refs.map((ref, index) => (
        <span className="mn-tcell-attachment" key={`${ref.sha256}-${index}`}>
          {IMAGE_ATTACHMENT.test(ref.name) && <AttachmentThumbnail refItem={ref} onOpen={() => setPreview(ref)} />}
          <a className="mn-tcell-attachment-name" href={attachmentUrl(ref.sha256)} download={ref.name} title={ref.name}>{ref.name}</a>
        </span>
      ))}</span>
      {preview && createPortal(
        <div className="mn-overlay mn-tcell-image-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreview(null); }}>
          <section className="mn-dialog mn-tcell-image-dialog" role="dialog" aria-modal="true" aria-label={`图片预览：${preview.name}`}>
            <header className="mn-dialog-head mn-tcell-image-head">
              <h2 className="mn-dialog-title">{preview.name}</h2>
              <button ref={closeRef} type="button" className="mn-iconbtn" aria-label="关闭图片预览" onClick={() => setPreview(null)}><X aria-hidden="true" /></button>
            </header>
            <div className="mn-tcell-image-stage"><img src={attachmentUrl(preview.sha256)} alt={preview.name} /></div>
            <footer className="mn-dialog-actions mn-tcell-image-actions">
              <a className="mn-auth-link" href={attachmentUrl(preview.sha256)} download={preview.name}>下载原图</a>
            </footer>
          </section>
        </div>, document.body,
      )}
    </>
  );
}

function AttachmentThumbnail({ refItem, onOpen }: { refItem: { sha256: string; name: string }; onOpen: () => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [src, setSrc] = useState(() => thumbnailCache.get(refItem.sha256) ?? "");
  useEffect(() => {
    let cancelled = false;
    const makeThumbnail = async () => {
      const cached = thumbnailCache.get(refItem.sha256);
      if (cached) { setSrc(cached); return; }
      try {
        const imageBlob = await fetchAttachmentBlob(refItem.sha256);
        if (!imageBlob) return;
        const bitmap = await createImageBitmap(imageBlob);
        const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) { bitmap.close(); return; }
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.48));
        if (!blob) return;
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("thumbnail_read_failed"));
          reader.onerror = () => reject(reader.error ?? new Error("thumbnail_read_failed"));
          reader.readAsDataURL(blob);
        });
        rememberThumbnail(refItem.sha256, dataUrl);
        if (!cancelled) setSrc(dataUrl);
      } catch {
        // Older browsers can still display the original scaled by CSS.
        if (!cancelled) setSrc(attachmentUrl(refItem.sha256));
      }
    };
    const button = buttonRef.current;
    if (!button) return () => { cancelled = true; };
    if (typeof IntersectionObserver === "undefined") void makeThumbnail();
    else {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) { observer.disconnect(); void makeThumbnail(); }
      }, { rootMargin: "80px" });
      observer.observe(button);
      return () => { cancelled = true; observer.disconnect(); };
    }
    return () => { cancelled = true; };
  }, [refItem.sha256]);
  return (
    <button ref={buttonRef} type="button" className="mn-tcell-attachment-thumb" aria-label={`预览图片 ${refItem.name}`} title={`预览图片 ${refItem.name}`} onClick={onOpen}>
      {src ? <img src={src} alt="" loading="lazy" /> : <span aria-hidden="true" />}
    </button>
  );
}

function AttachmentCell({ userId, value, onChange, attachmentItemId }: { userId: string; value: string; onChange: (value: string) => void; attachmentItemId?: string }) {
  const [accept, setAccept] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const refresh = () => { void readAttachmentPolicy(userId).then((policy) => setAccept(policy.allowedExtensions.map((extension) => `.${extension}`).join(","))); };
    refresh();
    window.addEventListener("menote:attachment-policy", refresh);
    return () => window.removeEventListener("menote:attachment-policy", refresh);
  }, [userId]);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setError("");
    try {
      let next = value;
      for (const file of Array.from(files)) {
        const uploaded = await (attachmentItemId ? uploadSealedAttachment(userId, attachmentItemId, file) : uploadAttachment(userId, file));
        if ("error" in uploaded) { setError(uploaded.error === "size_exceeded" ? "文件超过大小限制" : uploaded.error === "format_not_allowed" ? "格式不受支持" : "上传失败"); continue; }
        const name = uploaded.name.replace(/[\s()[\]<>|]+/g, "-");
        next = `${next}${next ? " · " : ""}[${name}](attachments/${uploaded.sha256}--${name})`;
      }
      onChange(next);
    } catch { setError("上传失败，请重试"); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  };
  return <div className="mn-tcell-attachment-editor">
    <AttachmentList value={value} attachmentItemId={attachmentItemId} />
    <button type="button" className="mn-tcell-attach-button" disabled={busy} aria-label={busy ? "正在上传附件" : "上传附件"} title={busy ? "正在上传…" : "上传附件"} onClick={() => inputRef.current?.click()}><Paperclip aria-hidden="true" /></button>
    <input ref={inputRef} type="file" multiple hidden accept={accept} onChange={(event) => void upload(event.currentTarget.files)} />
    {error && <span className="mn-tcell-attachment-error" role="alert">{error}</span>}
  </div>;
}

function CheckboxCell({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const isTrue = value === "true";
  const legacy = value !== "true" && value !== "false" && value !== "";
  return (
    <label className="mn-tcell-checkwrap mn-tcell-toggle">
      <input
        className="mn-tcell-check" type="checkbox" checked={isTrue}
        title={legacy ? `原值「${value}」，勾选后覆盖为 true/false` : "复选框单元格"}
        aria-label="复选框单元格"
        onChange={(e) => onChange(e.target.checked ? "true" : "false")}
      />
      {legacy && <span className="mn-tcell-legacy" aria-label={`历史值：${value}`}>{value}</span>}
    </label>
  );
}
