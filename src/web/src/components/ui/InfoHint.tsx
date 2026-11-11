/** 设置项说明（2026-11-10）：原本每行设置下面挂一段灰字说明，一屏十几行加起来
 *  把「能改什么」淹在「为什么」里。改成默认收成一枚 ⓘ，悬停或键盘聚焦才浮出原文。
 *
 *  可访问性：原文不删除，仍在 DOM 里并以 aria-describedby 关联到按钮，
 *  读屏仍能读到；显隐只切 opacity，不加 visibility/display，避免把文本从可访问性树里摘掉。
 *  触屏没有 hover：点按按钮即 :focus-visible，同样能展开。 */
import { useId, type ReactNode } from "react";
import { Info } from "../../icons";

export interface InfoHintProps {
  children: ReactNode;
}

export function InfoHint({ children }: InfoHintProps) {
  const id = useId();
  return (
    <span className="mn-infohint">
      <button
        type="button"
        className="mn-infohint-btn"
        aria-label="说明"
        aria-describedby={id}
        onClick={(event) => event.preventDefault()}
      >
        <Info aria-hidden="true" />
      </button>
      <span className="mn-infohint-tip" id={id} role="tooltip">{children}</span>
    </span>
  );
}
