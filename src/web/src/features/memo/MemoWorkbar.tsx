import { ChevronRight, Zap } from "../../icons";
import type { Item } from "@menote/shared";
import { heatGrid, memoCalendar, memoStats, memoText, onThisDay, tagCounts, type MemoRange } from "./memoView";
import { MemoViewToggle, type MemoView } from "./MemoBar";

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
  onClose: () => void;
  view: MemoView;
  onView: (view: MemoView) => void;
}

/** 工作栏：概述、热力图、随机漫步、那年今日、日期、标签。两视图共用，切换时不卸载。 */
export function MemoWorkbar({ memos, range, tag, onRange, onTag, onWander, onOpen, onClose, view, onView }: MemoWorkbarProps) {
  const stats = memoStats(memos);
  const heat = heatGrid(memos);
  const tags = tagCounts(memos);
  const today = onThisDay(memos);
  const calendar = memoCalendar(memos);
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  weekStart.setHours(0, 0, 0, 0);
  const weekMemos = memos.filter((memo) => memo.createdAt >= weekStart.getTime());
  const averageWords = weekMemos.length ? Math.round(weekMemos.reduce((sum, memo) => sum + memoText(memo).length, 0) / weekMemos.length) : 0;
  const uncategorized = weekMemos.filter((memo) => memo.tags.length === 0).length;
  return (
    <aside className="mn-memo-work" aria-label="Memo 工作栏">
      <button type="button" className="mn-memo-work-close" aria-label="关闭 Memo 侧记栏" onClick={onClose}>关闭</button>
      <section className="mn-memo-work-block mn-memo-view-block">
        <h2>视图</h2>
        <MemoViewToggle view={view} onView={onView} />
      </section>
      <section className="mn-memo-work-block mn-memo-calendar-block">
        <h2>{calendar.year} 年 {calendar.month + 1} 月</h2>
        <div className="mn-memo-calendar" aria-label="本月 Memo 记录日历">
          {["日", "一", "二", "三", "四", "五", "六"].map((day) => <span className="mn-memo-calendar-weekday" key={day}>{day}</span>)}
          {Array.from({ length: calendar.offset }, (_, index) => <i className="is-empty" key={`empty-${index}`} />)}
          {Array.from({ length: calendar.count }, (_, index) => { const day = index + 1; const count = calendar.days.get(day) ?? 0; return <span className={count ? "has-memo" : ""} data-count={count} key={day} aria-label={`${day} 日，${count} 条`}>{day}</span>; })}
        </div>
      </section>
      <section className="mn-memo-work-block mn-memo-streak-block">
        <div className="mn-memo-work-heading"><h2>连续记录</h2><strong>{calendar.streak} 天</strong></div>
        <div className="mn-memo-streak-chart" aria-label="最近 12 天记录频率">
          {calendar.streakCells.map((cell) => <i key={cell.day} data-level={cell.level} title={`${new Date(cell.day).toLocaleDateString()} · ${cell.count} 条`} />)}
        </div>
        <div className="mn-memo-streak-legend"><span>{new Date(calendar.streakCells[0]!.day).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}</span><span>今天</span></div>
      </section>
      <section className="mn-memo-work-block mn-memo-week-summary">
        <h2>本周</h2>
        <div className="mn-memo-week-stat"><span>新增碎片</span><b>{weekMemos.length}<small>条</small></b></div>
        <div className="mn-memo-week-stat"><span>日均字数</span><b>{averageWords}<small>字</small></b></div>
        <div className="mn-memo-week-stat"><span>待整理</span><b className={uncategorized ? "is-accent" : ""}>{uncategorized}<small>条</small></b></div>
      </section>
      {tags.length > 0 && <section className="mn-memo-work-block mn-memo-tag-distribution">
        <h2>标签分布</h2>
        <div className="mn-memo-tag-bars">
          {tags.slice(0, 4).map((item) => <div className="mn-memo-tag-bar" key={item.tag}><div><span>#{item.tag}</span><b>{item.count}</b></div><i><span data-level={Math.max(1, Math.ceil(item.count / tags[0]!.count * 4))} /></i></div>)}
        </div>
      </section>}
      <section className="mn-memo-work-block mn-memo-current-summary">
        <h2>概述 · 当前范围</h2>
        <div className="mn-memo-stats">
          <Stat value={stats.total} label="总条数" />
          <Stat value={stats.month} label="本月新增" />
          <Stat value={stats.days} label="记录天数" />
        </div>
      </section>
      <section className="mn-memo-work-block mn-memo-heat-block">
        <h2>热力图</h2>
        <p className="mn-memo-heat-sum">近 12 周 · {heat.total.toLocaleString()} 条</p>
        <div className="mn-memo-heat" aria-hidden="true">
          {heat.cells.map((cell) => <i key={cell.day} data-level={cell.level} title={`${cell.count} 条`} />)}
        </div>
        <p className="mn-memo-heat-legend"><span>少</span><i data-level="1" /><i data-level="2" /><i data-level="3" /><i data-level="4" /><span>多</span></p>
      </section>
      <section className="mn-memo-work-block mn-memo-wander-block">
        <button type="button" className="mn-memo-wander" onClick={onWander}>
          <Zap />随机漫步<ChevronRight />
        </button>
      </section>
      <section className="mn-memo-work-block mn-memo-on-this-day">
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
      <section className="mn-memo-work-block mn-memo-date-block">
        <h2>日期</h2>
        <div className="mn-memo-range" role="group" aria-label="日期范围">
          {RANGES.map((item) => (
            <button key={item.id} type="button" aria-pressed={range === item.id} onClick={() => onRange(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </section>
      <section className="mn-memo-work-block mn-memo-tag-filter">
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
