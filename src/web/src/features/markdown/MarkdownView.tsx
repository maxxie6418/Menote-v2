import { useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownViewProps {
  markdown: string;
  /** 传入时任务复选框可点击（FR-MEMO-3）；不传则复选框只读（Note 预览态）。 */
  onToggleTask?: (ordinal: number, checked: boolean) => void;
  className?: string;
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
  };
  return (
    <div className={className ?? "md-body"}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{markdown}</ReactMarkdown>
    </div>
  );
}
