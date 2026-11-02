import { useState } from "react";
import { DOC_STYLE_DEFAULTS, effectiveDocStyle, resetDocStyle, updateDocStyle, type DocStyleVars } from "../../lib/docStyle";

/**
 * 设置·样式（FR-STYLE-2）：只改正文渲染的 `--md-*` 变量，不动外壳配色。
 * 全局一套，改完即时生效并记住；「恢复默认」把它们从根节点摘掉，交回 tokens。
 * 布局按「每个元素一行」：四行的字号/字重/颜色竖着对齐，便于横向比较差异。
 */

type StyleTarget = "h1" | "h2" | "h3" | "strong";

const TARGETS: Array<{ id: StyleTarget; label: string; heading: boolean; fallbackSize: number | null }> = [
  { id: "h1", label: "一级标题", heading: true, fallbackSize: 32 },
  { id: "h2", label: "二级标题", heading: true, fallbackSize: 14 },
  { id: "h3", label: "三级标题", heading: true, fallbackSize: 14 },
  { id: "strong", label: "加粗", heading: false, fallbackSize: null },
];

const COLOR_PRESETS = [
  { value: "var(--app-fg)", label: "正文色" },
  { value: "var(--app-fg-muted)", label: "次要色" },
  { value: "var(--app-fg-subtle)", label: "弱化色" },
  { value: "var(--app-accent)", label: "强调色" },
];

const WEIGHTS = ["400", "500", "600", "700"];

const RULE_WIDTHS = [
  { value: "1px", label: "细 1" },
  { value: "2px", label: "中 2" },
  { value: "3px", label: "粗 3" },
];

const RULE_LENGTHS = [
  { value: "0.5rem", label: "略长" },
  { value: "0.75rem", label: "标准" },
  { value: "1.25rem", label: "舒展" },
];

const RULE_COLORS = [
  { value: "var(--app-accent)", label: "强调色" },
  { value: "var(--app-fg)", label: "文字色" },
  { value: "var(--app-border)", label: "边框色" },
];

/** token 里字号可能是 rem / 百分号，输入框只认像素数。 */
function sizeInPx(value: string, fallback: number): number {
  const rem = /^([\d.]+)rem$/.exec(value);
  if (rem) return Math.round(Number(rem[1]) * 16);
  const px = /^([\d.]+)px$/.exec(value);
  if (px) return Math.round(Number(px[1]));
  return fallback;
}

/** 切到「自定义颜色」时的起点：按当前主题给一个能看清的值，避免白底白字。 */
function themeDefaultColor(): string {
  return document.documentElement.dataset.theme === "dark" ? "#e9ebed" : "#1a1a18";
}

export function StyleSection() {
  const [vars, setVars] = useState<DocStyleVars>(effectiveDocStyle);
  const read = (key: string) => vars[key] ?? DOC_STYLE_DEFAULTS[key] ?? "";

  const update = (patch: DocStyleVars) => {
    setVars((previous) => ({ ...previous, ...patch }));
    updateDocStyle(patch);
  };

  const setUnderline = (target: StyleTarget, on: boolean) => {
    if (target === "strong") { update({ "--md-strong-rule": on ? "underline" : "none" }); return; }
    update({
      [`--md-${target}-rule`]: on ? "solid" : "none",
      [`--md-${target}-rule-pad`]: on ? "var(--md-heading-rule-gap)" : "var(--app-zero)",
    });
  };

  const reset = () => {
    resetDocStyle();
    setVars({ ...DOC_STYLE_DEFAULTS });
  };

  return (
    <div>
      <div className="mn-setrow">
        <div>
          <p className="mn-setlabel">文档样式</p>
          <p className="mn-sethint">
            只影响正文渲染（标题、加粗），不改界面配色；改动即时生效，全局一套，不进 Markdown。
            深色主题下自定义颜色建议选浅色。
          </p>
        </div>
        <button type="button" className="mn-textbtn" onClick={reset}>恢复默认</button>
      </div>

      {TARGETS.map((target) => {
        const sizeKey = `--md-${target.id}-size`;
        const weightKey = `--md-${target.id}-weight`;
        const colorKey = `--md-${target.id}-color`;
        const ruleKey = target.heading ? `--md-${target.id}-rule` : "--md-strong-rule";
        const color = read(colorKey);
        const preset = COLOR_PRESETS.some((entry) => entry.value === color);
        const rawSize = read(sizeKey);
        return (
          <div className="mn-stylerow" key={target.id}>
            <span className="mn-styllabel">{target.label}</span>
            <label className="mn-stylefield">字号
              <input
                type="number" min={10} max={64} step={1}
                aria-label={`${target.label}字号`}
                value={rawSize === "1em" || !target.fallbackSize ? "" : sizeInPx(rawSize, target.fallbackSize)}
                placeholder={target.heading ? undefined : "继承"}
                onChange={(event) => {
                  const text = event.target.value;
                  // 加粗允许留空 = 跟随正文（1em）
                  if (!text) { update({ [sizeKey]: "1em" }); return; }
                  const next = Number(text);
                  if (!Number.isFinite(next) || next < 6 || next > 96) return;
                  update({ [sizeKey]: `${next}px` });
                }}
              />
            </label>
            <label className="mn-stylefield">字重
              <select aria-label={`${target.label}字重`} value={read(weightKey)} onChange={(event) => update({ [weightKey]: event.target.value })}>
                {WEIGHTS.map((weight) => <option key={weight} value={weight}>{weight}</option>)}
              </select>
            </label>
            <label className="mn-stylefield">颜色
              <select
                aria-label={`${target.label}颜色`}
                value={preset ? color : "custom"}
                onChange={(event) => update({ [colorKey]: event.target.value === "custom" ? themeDefaultColor() : event.target.value })}
              >
                {COLOR_PRESETS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                <option value="custom">自定义</option>
              </select>
            </label>
            {!preset && (
              <input
                type="color" className="mn-stylecolor" aria-label={`${target.label}自定义颜色`}
                value={color} onChange={(event) => update({ [colorKey]: event.target.value })}
              />
            )}
            <label className="mn-stylecheck">
              <input
                type="checkbox"
                checked={read(ruleKey) !== "none"}
                onChange={(event) => setUnderline(target.id, event.target.checked)}
              />
              下划线
            </label>
          </div>
        );
      })}

      <div className="mn-stylerule">
        <span>装饰线</span>
        <label className="mn-stylefield">粗细
          <select aria-label="装饰线粗细" value={read("--md-heading-rule-width")} onChange={(event) => update({ "--md-heading-rule-width": event.target.value })}>
            {RULE_WIDTHS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </select>
        </label>
        <label className="mn-stylefield">长度
          <select aria-label="装饰线长度" value={read("--md-heading-rule-extra")} onChange={(event) => update({ "--md-heading-rule-extra": event.target.value })}>
            {RULE_LENGTHS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </select>
        </label>
        <label className="mn-stylefield">颜色
          <select aria-label="装饰线颜色" value={read("--md-heading-rule-color")} onChange={(event) => update({ "--md-heading-rule-color": event.target.value })}>
            {RULE_COLORS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </select>
        </label>
      </div>

      <div className="mn-stylepreview markdown-content" aria-label="样式预览">
        <h1>一级标题</h1>
        <h2>二级标题</h2>
        <h3>三级标题</h3>
        <p>正文示例：这里有一段<strong>加粗文字</strong>，用来看字重、颜色与下划线。</p>
      </div>
    </div>
  );
}
