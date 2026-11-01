import { ChevronRight, Zap } from "lucide-react";
import type { Item } from "@menote/shared";
import { heatGrid, memoStats, memoText, onThisDay, tagCounts, type MemoRange } from "./memoView";

const RANGES: Array<{ id: MemoRange; label: string }> = [
  { id: "all", label: "全部" },
  { id: "today", label: "今天" },
  { id: "7d", label: "近 7 天" },
  { id: "30d", label: "近 30 天" },
];

interface MemoWorkbarProps {
  memos: Item[];
  range: MemoRange;
  tag: string | null;
  onRange: (range: MemoRange) => void;
  onTag: (tag: string | null) => void;
  onWander: () => void;
  onOpen: (memoId: string) => void;
}

/** 工作栏：概述、热力图、随机漫步、那年今日、日期、标签。两视图共用，切换时不卸载。 */
export function MemoWorkbar({ memos, range, tag, onRange, onTag, onWander, onOpen }: MemoWorkbarProps) {
  const stats = memoStats(memos);
  const heat = heatGrid(memos);
  const tags = tagCounts(memos);
  const today = onThisDay(memos);
  return (
    <aside className="mn-memo-work" aria-label="Memo 工作栏">
      <section className="mn-memo-work-block">
        <h2>概述</h2>
        <div className="mn-memo-stats">
          <Stat value={stats.total} label="总条数" />
          <Stat value={stats.month} label="本月新增" />
          <Stat value={stats.days} label="记录天数" />
        </div>
      </section>
      <section className="mn-memo-work-block">
        <h2>热力图</h2>
        <p className="mn-memo-heat-sum">近 12 周 · {heat.total.toLocaleString()} 条</p>
        <div className="mn-memo-heat" aria-hidden="true">
          {heat.cells.map((cell) => <i key={cell.day} data-level={cell.level} title={`${cell.count} 条`} />)}
        </div>
        <p className="mn-memo-heat-legend"><span>少</span><i data-level="1" /><i data-level="2" /><i data-level="3" /><i data-level="4" /><span>多</span></p>
      </section>
      <section className="mn-memo-work-block">
        <button type="button" className="mn-memo-wander" onClick={onWander}>
          <Zap />随机漫步<ChevronRight />
        </button>
      </section>
      <section className="mn-memo-work-block">
        <h2>那年今日</h2>
        {today ? (
          <button type="button" className="mn-memo-otd" onClick={() => onOpen(today.memos[0]!.id)}>
            <span className="mn-memo-otd-head">
              <span>{today.when}</span>
              <span>{today.memos.length} 条</span>
            </span>
            <span className="mn-memo-otd-text">{memoText(today.memos[0]!).replace(/\s+/g, " ").slice(0, 48)}</span>
          </button>
        ) : (
          <p className="mn-memo-otd-empty">往年的今天没有 Memo。</p>
        )}
      </section>
      <section className="mn-memo-work-block">
        <h2>日期</h2>
        <div className="mn-memo-range" role="group" aria-label="日期范围">
          {RANGES.map((item) => (
            <button key={item.id} type="button" aria-pressed={range === item.id} onClick={() => onRange(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </section>
      <section className="mn-memo-work-block">
        <h2>标签</h2>
        <div className="mn-memo-taglist">
          <button type="button" aria-pressed={tag === null} onClick={() => onTag(null)}>
            全部<span>{stats.total.toLocaleString()}</span>
          </button>
          {tags.map((item) => (
            <button key={item.tag} type="button" aria-pressed={tag === item.tag} onClick={() => onTag(tag === item.tag ? null : item.tag)}>
              # {item.tag}<span>{item.count.toLocaleString()}</span>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <b>{value.toLocaleString()}</b>
      <span>{label}</span>
    </div>
  );
}
