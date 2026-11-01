import { ChevronLeft } from "lucide-react";

export type MemoView = "timeline" | "gallery";

interface MemoBarProps {
  count: number;
  unit: string;
  filtered: boolean;
  view: MemoView;
  onView: (view: MemoView) => void;
  onBack?: () => void;
}

/** Memo 顶栏（DESIGN §5.5）：返回是退路，无常驻底色。时间轴与图册共用这一条。 */
export function MemoBar({ count, unit, filtered, view, onView, onBack }: MemoBarProps) {
  return (
    <div className="mn-memo-bar">
      <div className="mn-memo-bar-left">
        {onBack && (
          <button type="button" className="mn-memo-back" onClick={onBack}>
            <ChevronLeft />
            笔记
          </button>
        )}
        {onBack && <span className="mn-memo-bar-div" aria-hidden="true" />}
        <span className="mn-memo-bar-title">Memo</span>
      </div>
      <span className="mn-memo-bar-count">{filtered ? "筛选" : "全部"} · {count.toLocaleString()} {unit}</span>
      <div className="mn-memo-view" role="group" aria-label="Memo 视图">
        <button type="button" aria-pressed={view === "timeline"} onClick={() => onView("timeline")}>时间轴</button>
        <button type="button" aria-pressed={view === "gallery"} onClick={() => onView("gallery")}>图册</button>
      </div>
    </div>
  );
}
