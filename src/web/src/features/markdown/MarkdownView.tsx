import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { attachmentUrl } from "../../services/attachmentService";
import { perfProbe } from "../../lib/perfProbe";
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
  /** 传入时任务复选框可点击（FR-MEMO-3）；不传则复选框只读（Note 预览态）。 */
  onToggleTask?: (ordinal: number, checked: boolean) => void;
  className?: string;
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
export function MarkdownView({ markdown, onToggleTask, className }: MarkdownViewProps) {
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
  const progressive = needsProgressiveRender(markdown, chunks.length);
  const [visibleCount, setVisibleCount] = useState(() => batchCount(chunks, 0, FIRST_BATCH_CHARS));

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

  /** 渲染序内每个复选框的序号（文档序稳定），供 onToggleTask 定位源文本行。 */
  const counter = useMemo(() => ({ ordinal: 0 }), [markdown]);
  counter.ordinal = 0;
  const components: Record<string, (props: { node?: unknown; [key: string]: unknown }) => ReactNode> = {
    input(props) {
      const { node, checked, type, ...rest } = props;
      void node;
      if (type !== "checkbox" || !onToggleTask) {
        return <input type="checkbox" checked={Boolean(checked)} disabled readOnly {...rest} />;
      }
      const ordinal = counter.ordinal;
      counter.ordinal += 1;
      return (
        <input
          type="checkbox" checked={Boolean(checked)} {...rest}
          onChange={(event) => onToggleTask(ordinal, event.target.checked)}
        />
      );
    },
    img(props) {
      const { node, ...rest } = props as { node?: unknown; src?: unknown; alt?: unknown; [key: string]: unknown };
      void node;
      const src = typeof rest.src === "string" ? rest.src : undefined;
      const alt = typeof rest.alt === "string" ? rest.alt : "";
      const imgProps: Record<string, unknown> = { ...rest };
      delete imgProps.src;
      delete imgProps.alt;
      return <img src={resolveSrc(src)} alt={alt} loading="lazy" {...imgProps} />;
    },
  };

  /** 渐进渲染时按块渲染：每块的复选框序号从该块的任务基数开始。 */
  const renderChunk = (chunk: BlockChunk, key: number) => {
    const chunkCounter = { ordinal: chunk.taskBase };
    const chunkComponents: Record<string, (props: { node?: unknown; [key: string]: unknown }) => ReactNode> = {
      ...components,
      input(props) {
        const { node, checked, type, ...rest } = props;
        void node;
        if (type !== "checkbox" || !onToggleTask) {
          return <input type="checkbox" checked={Boolean(checked)} disabled readOnly {...rest} />;
        }
        const ordinal = chunkCounter.ordinal;
        chunkCounter.ordinal += 1;
        return (
          <input
            type="checkbox" checked={Boolean(checked)} {...rest}
            onChange={(event) => onToggleTask(ordinal, event.target.checked)}
          />
        );
      },
    };
    return (
      <ReactMarkdown key={key} remarkPlugins={[remarkGfm]} components={chunkComponents}>{chunk.text}</ReactMarkdown>
    );
  };

  if (lightweight) {
    // 极端兜底：文档过大时只渲染纯文本，内容完整不截断。
    return (
      <div className={className ?? "md-body"}>
        <p className="md-lite-notice" role="status">
          文档过大（{markdown.length} 字符），已切换轻量模式：正文以纯文本显示，内容完整未截断。
        </p>
        <pre className="md-lite-text">{markdown}</pre>
      </div>
    );
  }

  if (progressive) {
    return (
      <div className={className ?? "md-body"}>
        {chunks.slice(0, visibleCount).map((chunk, index) => renderChunk(chunk, index))}
      </div>
    );
  }

  return (
    <div className={className ?? "md-body"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{markdown}</ReactMarkdown>
    </div>
  );
}
