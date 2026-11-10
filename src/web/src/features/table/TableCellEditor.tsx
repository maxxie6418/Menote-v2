import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { joinMultiCell, normalizeCellValue, splitMultiCell } from "../../lib/gfmTable";
import type { OptionColor, PropertyDef, PropertyType } from "../../lib/frontmatter";
import { safeWebUrl } from "../../lib/safeUrl";
import { Paperclip, X } from "lucide-react";
import { extractAttachmentRefs } from "../../lib/attachmentRefs";
import { attachmentUrl, uploadAttachment } from "../../services/attachmentService";
import { readAttachmentPolicy } from "../../services/attachmentPolicyService";

interface TableCellEditorProps {
  userId?: string;
  allowAttachments?: boolean;
  value: string;
  type: PropertyType;
  /** 字段定义（候选值来源）；无定义的列由调用方按 text 分派（FR-TBL-4/5）。 */
  def?: PropertyDef;
  onChange: (value: string) => void;
  /** 预览态：只呈现内容，不接受任何输入（FR-TBL-20）。 */
  readOnly?: boolean;
  /** 该列开启自动换行：文本类单元格换成多行控件，行高随内容长高。 */
  wrap?: boolean;
}

/** 类型化单元格控件（FR-TBL-7）：表格文档与 Note 内表格弹窗（双轨 FR-TBL-2）共用。
 *  写回契约见 lib/gfmTable（FR-TBL-6）；历史值不静默修正，编辑时才按类型覆盖（FR-TBL-4 精神）。 */
export function TableCellEditor({ userId, allowAttachments = true, value, type, def, onChange, readOnly = false, wrap = false }: TableCellEditorProps) {
  if (readOnly) return <CellContent value={value} type={type} def={def} wrap={wrap} />;
  let editor: ReactNode;
  if (type === "attachment") {
    editor = allowAttachments && userId ? <AttachmentCell userId={userId} value={value} onChange={onChange} /> : <AttachmentList value={value} />;
  } else if (type === "checkbox") {
    editor = <CheckboxCell value={value} onChange={onChange} />;
  } else if (type === "select") {
    const options = def?.options ?? [];
    // 候选必须显式定义（FR-PROP-4）；未定义候选时按文本编辑，候选在列设置中维护。
    if (options.length === 0) editor = <TextCell value={value} onChange={onChange} wrap={wrap} aria-label="单选单元格" />;
    else editor = <SingleSelectCell value={value} options={options} colors={def?.optionColors ?? {}} onChange={onChange} />;
  } else if (type === "multiselect") {
    const options = def?.options ?? [];
    if (options.length === 0) {
      editor = (
        <TextCell value={value} onChange={onChange} wrap={wrap} aria-label="多选单元格（逗号分隔）"
          normalize={(next) => joinMultiCell(splitMultiCell(next))} />
      );
    } else editor = <MultiSelectCell value={value} options={options} colors={def?.optionColors ?? {}} onChange={onChange} />;
  } else if (type === "date") {
    // 日期控件只接受 ISO 形态；历史自由文本保留原样，清空或改正后回到日期控件。
    if (value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      editor = <input className="mn-tcell-input" type="date" value={value} title={value} aria-label="日期单元格" onChange={(e) => onChange(e.target.value)} onBlur={(e) => onChange(normalizeCellValue(e.currentTarget.value))} />;
    } else {
      editor = <input className="mn-tcell-input" type="text" size={Math.max(12, Math.min(80, value.length || 12))} value={value} title={value} aria-label="日期单元格（非标准格式，编辑后按日期处理）" onChange={(e) => onChange(e.target.value)} onBlur={(e) => onChange(normalizeCellValue(e.currentTarget.value))} />;
    }
  } else {
    editor = <TextCell value={value} onChange={onChange} wrap={wrap}
      aria-label={type === "number" ? "数字单元格" : type === "link" ? "链接单元格" : "单元格"}
      numeric={type === "number"} />;
  }
  return <CellEditorShell value={value} onRestore={onChange}>{editor}</CellEditorShell>;
}

/** 文本类单元格：默认单行输入（与历史行为一致），列开启换行时改用自增高多行控件。 */
function TextCell({ value, onChange, wrap, normalize, numeric, "aria-label": ariaLabel }: {
  value: string;
  onChange: (value: string) => void;
  wrap: boolean;
  normalize?: (value: string) => string;
  numeric?: boolean;
  "aria-label": string;
}) {
  if (!wrap) {
    return (
      <input className="mn-tcell-input" type={numeric ? "number" : "text"} size={Math.max(12, Math.min(80, value.length || 12))} value={value} title={value} aria-label={ariaLabel}
        onChange={(e) => onChange(normalize ? normalize(e.target.value) : e.target.value)}
        onBlur={(e) => onChange(normalizeCellValue(e.currentTarget.value))} />
    );
  }
  return (
    <GrowingTextarea value={value} ariaLabel={ariaLabel}
      onChange={(next) => onChange(normalize ? normalize(next) : next)}
      onCommit={(next) => onChange(normalizeCellValue(next))} />
  );
}

/** 自增高多行输入：高度跟着内容走，行高随之长高（换行列的「显示全部内容」语义）。 */
function GrowingTextarea({ value, onChange, onCommit, ariaLabel }: {
  value: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  ariaLabel: string;
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
    <textarea ref={ref} className="mn-tcell-textarea" rows={1} value={value} aria-label={ariaLabel} title={value}
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
function CellContent({ value, type, def, wrap }: { value: string; type: PropertyType; def?: PropertyDef; wrap: boolean }) {
  const colors = def?.optionColors ?? {};
  if (type === "attachment") return <AttachmentList value={value} />;
  if (type === "checkbox") {
    return (
      <span className="mn-tcell-checkwrap">
        <span className={`mn-tcell-checkmark${value === "true" ? " on" : ""}`} aria-hidden="true">{value === "true" ? "✓" : ""}</span>
        {value !== "true" && value !== "false" && value !== "" && <span className="mn-tcell-legacy">{value}</span>}
      </span>
    );
  }
  if (type === "select") return <span className="mn-tcell-pill mn-tcell-pill-single" data-tone={colors[value] ?? "neutral"}>{value || "（空）"}</span>;
  if (type === "multiselect") {
    const selected = splitMultiCell(value);
    return (
      <span className="mn-tcell-readmulti">
        {selected.length === 0
          ? <span className="mn-tcell-pill mn-tcell-pill-multi" data-tone="neutral">（空）</span>
          : selected.map((item) => <span className="mn-tcell-pill mn-tcell-pill-multi" data-tone={colors[item] ?? "neutral"} key={item}>{item}</span>)}
      </span>
    );
  }
  const url = type === "link" ? safeWebUrl(value) : null;
  if (url) {
    return <a className="mn-tcell-text mn-tcell-link" data-wrap={wrap ? "true" : "false"} href={url} target="_blank" rel="noreferrer" title={value}>{value}</a>;
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

function AttachmentList({ value }: { value: string }) {
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
  if (!refs.length) return <span className="mn-tcell-attachment-empty">无附件</span>;
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
        const response = await fetch(attachmentUrl(refItem.sha256), { cache: "force-cache" });
        if (!response.ok) return;
        const bitmap = await createImageBitmap(await response.blob());
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

function AttachmentCell({ userId, value, onChange }: { userId: string; value: string; onChange: (value: string) => void }) {
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
        const uploaded = await uploadAttachment(userId, file);
        if ("error" in uploaded) { setError(uploaded.error === "size_exceeded" ? "文件超过大小限制" : uploaded.error === "format_not_allowed" ? "格式不受支持" : "上传失败"); continue; }
        const name = uploaded.name.replace(/[\s()[\]<>|]+/g, "-");
        next = `${next}${next ? " · " : ""}[${name}](attachments/${uploaded.sha256}--${name})`;
      }
      onChange(next);
    } catch { setError("上传失败，请重试"); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  };
  return <div className="mn-tcell-attachment-editor">
    <AttachmentList value={value} />
    <button type="button" className="mn-tcell-attach-button" disabled={busy} aria-label={busy ? "正在上传附件" : "上传附件"} title={busy ? "正在上传…" : "上传附件"} onClick={() => inputRef.current?.click()}><Paperclip aria-hidden="true" /></button>
    <input ref={inputRef} type="file" multiple hidden accept={accept} onChange={(event) => void upload(event.currentTarget.files)} />
    {error && <span className="mn-tcell-attachment-error" role="alert">{error}</span>}
  </div>;
}

function CheckboxCell({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const isTrue = value === "true";
  const legacy = value !== "true" && value !== "false" && value !== "";
  return (
    <span className="mn-tcell-checkwrap">
      <input
        className="mn-tcell-check" type="checkbox" checked={isTrue}
        title={legacy ? `原值「${value}」，勾选后覆盖为 true/false` : "复选框单元格"}
        aria-label="复选框单元格"
        onChange={(e) => onChange(e.target.checked ? "true" : "false")}
      />
      {legacy && <span className="mn-tcell-legacy" aria-label={`历史值：${value}`}>{value}</span>}
    </span>
  );
}

function SingleSelectCell({ value, options, colors, onChange }: {
  value: string; options: string[]; colors: Record<string, OptionColor>; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="mn-tcell-single" ref={rootRef}>
      <button type="button" className="mn-tcell-single-trigger" aria-label="单选单元格" aria-expanded={open} title={value || "空单元格"}
        onClick={() => setOpen((current) => !current)}>
        <span className="mn-tcell-pill mn-tcell-pill-single" data-tone={colors[value] ?? "neutral"}>{value || "（空）"}</span>
      </button>
      {open && (
        <div className="mn-tcell-pop" role="listbox" aria-label="单选候选">
          <button type="button" className="mn-tcell-pickrow" role="option" aria-selected={value === ""}
            onClick={() => { onChange(""); setOpen(false); }}>
            <span className="mn-tcell-pill mn-tcell-pill-single" data-tone="neutral">（空）</span>
          </button>
          {options.map((option) => (
            <button type="button" className="mn-tcell-pickrow" key={option} role="option" aria-selected={value === option}
              onClick={() => { onChange(option); setOpen(false); }}>
              <span className="mn-tcell-pill mn-tcell-pill-single" data-tone={colors[option] ?? "neutral"}>{option}</span>
            </button>
          ))}
          {value && !options.includes(value) && (
            <span className="mn-tcell-pickrow"><span className="mn-tcell-pill mn-tcell-pill-single" data-tone="neutral">{value}（候选外）</span></span>
          )}
        </div>
      )}
    </div>
  );
}

/** 多选候选标签勾选（FR-TBL-6 写回契约 joinMultiCell）；候选外的历史值保留展示、可移除。 */
function MultiSelectCell({ value, options, colors, onChange }: {
  value: string; options: string[]; colors: Record<string, OptionColor>; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = splitMultiCell(value);
  const extras = selected.filter((item) => !options.includes(item));

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = (option: string) => {
    onChange(joinMultiCell(selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option]));
  };

  return (
    <div className="mn-tcell-multi" ref={rootRef}>
      <button type="button" className="mn-tcell-multibtn" aria-label="多选单元格" aria-expanded={open} title={selected.join("，") || "空单元格"}
        onClick={() => setOpen((v) => !v)}>
        {selected.length === 0
          ? <span className="mn-tcell-pill mn-tcell-pill-multi" data-tone="neutral">（空）</span>
          : selected.map((item) => <span className="mn-tcell-pill mn-tcell-pill-multi" data-tone={colors[item] ?? "neutral"} key={item}>{item}</span>)}
      </button>
      {open && (
        <div className="mn-tcell-pop" role="group" aria-label="多选候选">
          {options.map((option) => (
            <label key={option} className="mn-tcell-poprow">
              <input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} />
              <span className="mn-tcell-pill mn-tcell-pill-multi" data-tone={colors[option] ?? "neutral"}>{option}</span>
            </label>
          ))}
          {extras.map((option) => (
            <label key={option} className="mn-tcell-poprow">
              <input type="checkbox" checked onChange={() => toggle(option)} />
              <span className="mn-tcell-pill mn-tcell-pill-multi" data-tone="neutral">{option}（候选外）</span>
            </label>
          ))}
          {options.length === 0 && extras.length === 0 && <span className="mn-tcell-pophint">暂无候选</span>}
        </div>
      )}
    </div>
  );
}
