import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type Ref } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { findMemoTagRanges } from "@menote/shared";
import { attachmentUrl } from "../../services/attachmentService";
import { appRoutePath, itemRoutePath } from "../../app/appRoutes";
import { perfProbe } from "../../lib/perfProbe";
import { extractAttachmentRefs, parseAttachmentDestination, type AttachmentRef } from "../../lib/attachmentRefs";
import { remarkNoteUnderline } from "../../lib/noteUnderline";
import { normalizeObsidianName, obsidianAnchor, remarkObsidianSyntax } from "../../lib/obsidianMarkdown";
import { remarkObsidianPreview } from "../../lib/obsidianPreview";
import { obsidianNoteTarget, useObsidianTargets } from "../../services/obsidianReferenceService";
import { remarkTextColorForRender } from "../editor";
import { UnlockedAttachment } from "../attachments";
import { ObsidianReference, type ObsidianView } from "./ObsidianReference";
import {
  batchCount,
  FIRST_BATCH_CHARS,
  IDLE_BATCH_CHARS,
  needsLightweightMode,
  needsProgressiveRender,
  splitTopLevelBlocks,
  type BlockChunk,
} from "../../lib/markdownBlocks";

interface MarkdownViewProps {
  markdown: string;
  ref?: Ref<HTMLDivElement>;
  /** 传入时任务复选框可点击（FR-MEMO-3）；不传则复选框只读（Note 预览态）。 */
  onToggleTask?: (ordinal: number, checked: boolean) => void;
  /** 传入时图片可用鼠标或键盘打开预览；Memo 时间线使用。 */
  onImageClick?: (src: string, alt: string) => void;
  /** 随记展示态将正文里的 #标签渲染为轻量强调样式，不修改源文本。 */
  highlightMemoTags?: boolean;
  className?: string;
  attachmentItemId?: string;
  obsidian?: ObsidianView;
}

const STANDARD_PLUGINS: ComponentProps<typeof ReactMarkdown>["remarkPlugins"] = [
  remarkGfm, remarkTextColorForRender, [remarkNoteUnderline, { preview: true }],
];
const OBSIDIAN_PLUGINS: ComponentProps<typeof ReactMarkdown>["remarkPlugins"] = [
  ...STANDARD_PLUGINS, remarkMath, remarkObsidianSyntax, remarkObsidianPreview,
];
const KATEX_OPTIONS = { trust: false, maxExpand: 500, maxSize: 25 };

interface HastNode {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function rehypeMemoTags() {
  return (tree: unknown) => decorateMemoTags(tree as HastNode);
}

/** 任务顺序在 Markdown 树中确定，重复渲染不会改变序号。 */
function rehypeTaskOrdinals(taskBase: number) {
  return (tree: unknown) => {
    let ordinal = taskBase;
    const visit = (node: HastNode) => {
      if (node.tagName === "input" && node.properties?.type === "checkbox") {
        node.properties.dataTaskOrdinal = ordinal++;
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree as HastNode);
  };
}

function decorateMemoTags(node: HastNode): void {
  if (!node.children) return;
  const children: HastNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && typeof child.value === "string") {
      const ranges = findMemoTagRanges(child.value);
      if (ranges.length === 0) {
        children.push(child);
        continue;
      }
      let cursor = 0;
      for (const range of ranges) {
        if (range.start > cursor) children.push({ type: "text", value: child.value.slice(cursor, range.start) });
        children.push({
          type: "element",
          tagName: "span",
          properties: { className: ["mn-memo-inline-tag"] },
          children: [{ type: "text", value: child.value.slice(range.start, range.end) }],
        });
        cursor = range.end;
      }
      if (cursor < child.value.length) children.push({ type: "text", value: child.value.slice(cursor) });
      continue;
    }
    decorateMemoTags(child);
    children.push(child);
  }
  node.children = children;
}

/** 相对附件引用解析为鉴权 URL（FR-SYNC-7）；会话 cookie 授权。 */
function resolveSrc(src: string | undefined): string | undefined {
  const match = typeof src === "string" ? src.match(/^attachments\/([0-9a-f]{64})--/) : null;
  return match ? attachmentUrl(match[1]!) : src;
}

/** 空闲时执行；浏览器不支持 requestIdleCallback 时退回定时器。 */
function scheduleIdle(run: () => void): { kind: "idle"; id: number } | { kind: "timer"; id: number } {
  if (typeof window.requestIdleCallback === "function") {
    return { kind: "idle", id: window.requestIdleCallback(() => run()) };
  }
  return { kind: "timer", id: window.setTimeout(run, 50) };
}

function cancelIdle(handle: { kind: "idle" | "timer"; id: number }): void {
  if (handle.kind === "idle") {
    if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(handle.id);
    return;
  }
  window.clearTimeout(handle.id);
}

/** Markdown 渲染（md-* tokens 驱动样式）；不支持的语法由渲染器降级显示，不改写内容（C-1）。 */
export function MarkdownView({ markdown, ref, onToggleTask, onImageClick, highlightMemoTags = false, className, attachmentItemId, obsidian }: MarkdownViewProps) {
  // 渲染耗时基线（FR-EDT-10 / W0）：渲染开始 → 布局提交完成。诊断关闭时不打点。
  const renderStart = perfProbe.isEnabled ? performance.now() : 0;
  const renderStartRef = useRef(renderStart);
  renderStartRef.current = renderStart;
  useLayoutEffect(() => {
    if (renderStartRef.current > 0) {
      perfProbe.record("preview.render", performance.now() - renderStartRef.current);
    }
  });

  // 渐进渲染（FR-EDT-10 / W3c）：长文档先出可视区，其余空闲补齐；极端超长切纯文本。
  const chunks = useMemo(() => splitTopLevelBlocks(markdown), [markdown]);
  const lightweight = needsLightweightMode(markdown);
  const hasWiki = Boolean(obsidian && markdown.includes("[["));
  const hasNoteLinks = hasWiki || Boolean(obsidian && /\.m(?:d|arkdown)(?:[#?)\s>])/i.test(markdown));
  const hasHeadingTarget = typeof window !== "undefined" && !obsidian?.trail && window.location.hash.startsWith("#obsidian-heading-");
  const needsWholeTree = Boolean(obsidian && (hasHeadingTarget || /\[\^|\^\[|%%/.test(markdown)));
  const progressive = !needsWholeTree && needsProgressiveRender(markdown, chunks.length);
  const [visibleCount, setVisibleCount] = useState(() => batchCount(chunks, 0, FIRST_BATCH_CHARS));
  const fetchedTargets = useObsidianTargets(obsidian?.userId, hasNoteLinks && !lightweight && !obsidian?.targets);
  const targets = obsidian?.targets ?? fetchedTargets;
  const attachments = useMemo(() => {
    const refs = new Map<string, AttachmentRef | null>();
    if (!hasWiki) return refs;
    for (const { sha256, name } of extractAttachmentRefs(markdown)) {
      const ref = parseAttachmentDestination(`attachments/${sha256}--${name}`);
      if (!ref) continue;
      const key = normalizeObsidianName(ref.name);
      if (refs.has(key) && refs.get(key)?.sha256 !== sha256) refs.set(key, null);
      else refs.set(key, ref);
    }
    return refs;
  }, [markdown, hasWiki]);
  const remarkPlugins = obsidian ? OBSIDIAN_PLUGINS : STANDARD_PLUGINS;
  const rehypePlugins: ComponentProps<typeof ReactMarkdown>["rehypePlugins"] = [
    ...(highlightMemoTags ? [rehypeMemoTags] : []),
    ...(obsidian ? [[rehypeKatex, KATEX_OPTIONS] as [typeof rehypeKatex, typeof KATEX_OPTIONS]] : []),
  ];
  const pluginsFor = (taskBase: number): ComponentProps<typeof ReactMarkdown>["rehypePlugins"] =>
    onToggleTask ? [...rehypePlugins, [rehypeTaskOrdinals, taskBase]] : rehypePlugins;
  const remarkRehypeOptions = obsidian ? { footnoteLabel: "脚注", footnoteBackLabel: "返回脚注引用",
    clobberPrefix: obsidian.trail ? `obsidian-${obsidian.itemId}-` : undefined } : undefined;

  // 文档换了就回到首屏批次。
  useEffect(() => {
    setVisibleCount(batchCount(chunks, 0, FIRST_BATCH_CHARS));
  }, [chunks]);

  // 空闲补齐：每轮空闲再渲染一批，直到整篇可见。
  useEffect(() => {
    if (!progressive || visibleCount >= chunks.length) return;
    const handle = scheduleIdle(() => {
      setVisibleCount((current) => Math.min(chunks.length, current + batchCount(chunks, current, IDLE_BATCH_CHARS)));
    });
    return () => cancelIdle(handle);
  }, [progressive, visibleCount, chunks]);

  useEffect(() => {
    if (!obsidian || obsidian.trail) return;
    const scroll = () => {
      const hash = window.location.hash.slice(1);
      if (!hash.startsWith("obsidian-")) return;
      try { document.getElementById(decodeURIComponent(hash))?.scrollIntoView(); } catch { /* Invalid URL escape. */ }
    };
    scroll();
    window.addEventListener("hashchange", scroll);
    return () => window.removeEventListener("hashchange", scroll);
  }, [obsidian?.itemId, obsidian?.trail, visibleCount]);

  const wikiReference = (block: boolean, props: { node?: unknown; [key: string]: unknown }) => {
    const { node, children, ...attributes } = props;
    void node;
    const label = children as ReactNode;
    if (obsidian && attributes["data-obsidian-reference"]) {
      return <ObsidianReference block={block} data={attributes} label={label} view={obsidian} source={markdown}
        attachments={attachments} targets={targets} encryptedAttachmentItemId={attachmentItemId}
        renderEmbedded={(body, next) => <MarkdownView markdown={body} obsidian={next} className="markdown-content md-body" />} />;
    }
    const tag = attributes["data-obsidian-tag"];
    if (obsidian && typeof tag === "string" && !attachmentItemId) {
      return <a className="mn-memo-tag" href={appRoutePath({ kind: "notes", section: { kind: "tag", tag } })}>{label}</a>;
    }
    return block ? <div {...attributes}>{label}</div> : <span {...attributes}>{label}</span>;
  };
  const components: Record<string, (props: { node?: unknown; [key: string]: unknown }) => ReactNode> = {
    ...(obsidian ? { span: (props) => wikiReference(false, props), div: (props) => wikiReference(true, props) } : {}),
    input(props) {
      const { node, checked, type, "data-task-ordinal": _ordinal, ...rest } = props;
      const ordinal = (node as HastNode | undefined)?.properties?.dataTaskOrdinal;
      if (type !== "checkbox" || !onToggleTask || typeof ordinal !== "number") {
        return <input type="checkbox" checked={Boolean(checked)} {...rest} disabled readOnly />;
      }
      return (
        <input
          type="checkbox" checked={Boolean(checked)} {...rest} disabled={false}
          onChange={(event) => onToggleTask(ordinal, event.target.checked)}
        />
      );
    },
    a({ node, href, children, ...rest }) {
      void node;
      const link = typeof href === "string" ? href : undefined;
      const attachment = link && parseAttachmentDestination(link);
      if (attachment && attachmentItemId) return <UnlockedAttachment itemId={attachmentItemId} {...attachment}>{children as ReactNode}</UnlockedAttachment>;
      let resolved = resolveSrc(link);
      if (obsidian && link && !attachment && !rest["data-footnote-ref"] && !rest["data-footnote-backref"]) {
        const noteLink = /^(?![a-z][a-z\d+.-]*:|\/)([^#?]*\.m(?:d|arkdown))?(?:#([^?]+))?$/i.exec(link);
        if (noteLink) {
          try {
            const path = noteLink[1] ? decodeURIComponent(noteLink[1]).replace(/\.markdown$/i, ".md") : "";
            const heading = noteLink[2] ? decodeURIComponent(noteLink[2]) : "";
            const id = path ? obsidianNoteTarget(targets, path) : obsidian.itemId;
            const anchor = heading.startsWith("^") ? obsidianAnchor({ blockId: heading.slice(1) }) : obsidianAnchor({ heading });
            if (id && (path || (anchor && !heading.startsWith("obsidian-")))) {
              resolved = `${path ? itemRoutePath(id) : ""}${anchor ? `#${encodeURIComponent(anchor)}` : ""}`;
            }
          } catch { /* Keep links with malformed escapes in their original form. */ }
        }
      }
      return <a {...rest} href={resolved}>{children as ReactNode}</a>;
    },
    img(props) {
      const { node, ...rest } = props as { node?: unknown; src?: unknown; alt?: unknown; [key: string]: unknown };
      void node;
      const src = typeof rest.src === "string" ? rest.src : undefined;
      let alt = typeof rest.alt === "string" ? rest.alt : "";
      const size = obsidian ? /^(?:(.*?)\|)?([1-9]\d{0,4})(?:x([1-9]\d{0,4}))?$/.exec(alt) : null;
      if (size) alt = size[1] ?? (typeof rest.title === "string" ? rest.title : "");
      const attachment = src && parseAttachmentDestination(src);
      if (attachment && attachmentItemId) return <UnlockedAttachment itemId={attachmentItemId} sha256={attachment.sha256} name={alt || attachment.name} image />;
      const imgProps: Record<string, unknown> = { ...rest };
      delete imgProps.src;
      delete imgProps.alt;
      const resolved = resolveSrc(src);
      const imageClass = [typeof imgProps.className === "string" ? imgProps.className : "", onImageClick ? "md-image-zoomable" : ""]
        .filter(Boolean).join(" ");
      return (
        <img
          {...imgProps}
          src={resolved}
          alt={alt}
          width={size ? Number(size[2]) : undefined}
          height={size?.[3] ? Number(size[3]) : undefined}
          loading="lazy"
          className={imageClass || undefined}
          {...(onImageClick && resolved ? {
            role: "button",
            tabIndex: 0,
            "aria-label": alt ? `放大查看图片：${alt}` : "放大查看图片",
            draggable: false,
            onPointerDown: (event: ReactPointerEvent<HTMLImageElement>) => event.stopPropagation(),
            onClick: (event: ReactMouseEvent<HTMLImageElement>) => {
              event.preventDefault();
              event.stopPropagation();
              onImageClick(resolved, alt);
            },
            onKeyDown: (event: ReactKeyboardEvent<HTMLImageElement>) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              onImageClick(resolved, alt);
            },
          } : {})}
        />
      );
    },
  };

  const renderChunk = (chunk: BlockChunk, key: number) => (
    <ReactMarkdown key={key} remarkPlugins={remarkPlugins} rehypePlugins={pluginsFor(chunk.taskBase)}
      remarkRehypeOptions={remarkRehypeOptions} components={components}>{chunk.text}</ReactMarkdown>
  );

  if (lightweight) {
    // 极端兜底：文档过大时只渲染纯文本，内容完整不截断。
    return (
      <div ref={ref} className={className ?? "md-body"}>
        <p className="md-lite-notice" role="status">
          文档过大（{markdown.length} 字符），已切换轻量模式：正文以纯文本显示，内容完整未截断。
        </p>
        <pre className="md-lite-text">{markdown}</pre>
      </div>
    );
  }

  if (progressive) {
    return (
      <div ref={ref} className={className ?? "md-body"}>
        {chunks.slice(0, visibleCount).map((chunk, index) => renderChunk(chunk, index))}
      </div>
    );
  }

  return (
    <div ref={ref} className={className ?? "md-body"}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={pluginsFor(0)}
        remarkRehypeOptions={remarkRehypeOptions} components={components}>{markdown}</ReactMarkdown>
    </div>
  );
}
