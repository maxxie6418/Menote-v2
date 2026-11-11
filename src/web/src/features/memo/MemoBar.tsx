import { ChevronLeft } from "../../icons";

export type MemoView = "timeline" | "gallery";

interface MemoBarProps {
  count: number;
  unit: string;
  filtered: boolean;
  onBack?: () => void;
}

/** Memo 顶栏（DESIGN §5.5）：保留返回、标题与当前结果计数。 */
export function MemoBar({ count, unit, filtered, onBack }: MemoBarProps) {
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
    </div>
  );
}

export function MemoViewToggle({ view, onView }: { view: MemoView; onView: (view: MemoView) => void }) {
  return (
    <div className="mn-memo-view" role="group" aria-label="Memo 视图">
      <button type="button" aria-pressed={view === "timeline"} onClick={() => onView("timeline")}>时间轴</button>
      <button type="button" aria-pressed={view === "gallery"} onClick={() => onView("gallery")}>图册</button>
    </div>
  );
}
