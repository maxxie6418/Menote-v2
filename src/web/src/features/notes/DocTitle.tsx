import { useLayoutEffect, useRef } from "react";

/**
 * 文档标题输入框：单行语义、超长自动换行。
 *
 * 原来用 `<input>`，它不能折行——标题一长，尾部就被推到可视区外，既看不见也点不到，
 * 只能横向拖光标。改成 `textarea` + 随内容自动撑高：内容多长就多高，
 * 宽度仍由 `.mn-docbody > *` 的版心约束，所以换行位置跟正文一致。
 *
 * 标题是单值字段，Enter 视为「提交」（失焦触发保存），不插入换行符。
 */
export function DocTitle({
  value,
  readOnly = false,
  onChange,
  onCommit,
}: {
  value: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onCommit?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const fit = () => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  };

  // 内容变化时重算高度；窗口或阅读宽度档位变化会改变行宽，也要重算
  useLayoutEffect(fit, [value]);
  useLayoutEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  return (
    <textarea
      ref={ref}
      className="mn-doc-title"
      rows={1}
      value={value}
      aria-label="标题"
      readOnly={readOnly}
      onChange={(event) => onChange?.(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.currentTarget.blur();
      }}
      onBlur={onCommit}
    />
  );
}
