/** 侧栏段标题（主题 / 标签）：11/500/faint，层级由字号字重承担，不画延展线。
    右侧动作悬停才加实——低频动作不常驻（新建主题收进标题行，2026-11-03 定稿）。 */
export interface SectionHeadProps {
  label: string;
  count?: number;
  action?: {
    label: string;
    icon: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    title?: string;
  };
}

export function SectionHead({ label, count, action }: SectionHeadProps) {
  return (
    <div className="mn-sechead">
      <span className="mn-sechead-t">{label}</span>
      {typeof count === "number" && <span className="mn-sechead-c">{count}</span>}
      <span className="mn-sechead-sp" aria-hidden="true" />
      {action && (
        <button type="button" className="mn-sechead-a" aria-label={action.label} title={action.title ?? action.label}
          onClick={action.onClick} disabled={action.disabled}>
          {action.icon}
        </button>
      )}
    </div>
  );
}
