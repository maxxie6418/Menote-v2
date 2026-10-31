import { useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { attachmentUrl } from "../../services/attachmentService";

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

/** Markdown 渲染（md-* tokens 驱动样式）；不支持的语法由渲染器降级显示，不改写内容（C-1）。 */
export function MarkdownView({ markdown, onToggleTask, className }: MarkdownViewProps) {
  // 渲染序内每个复选框的序号（文档序稳定），供 onToggleTask 定位源文本行。
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
  return (
    <div className={className ?? "md-body"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{markdown}</ReactMarkdown>
    </div>
  );
}
