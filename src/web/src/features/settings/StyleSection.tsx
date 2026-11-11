import { useEffect, useState } from "react";
import { updateAppearance } from "../../services/appearanceSettingsService";
import { DOC_STYLE_DEFAULTS, effectiveDocStyle, resetDocStyle, updateDocStyle, type DocStyleVars } from "../../lib/docStyle";
import { InfoHint } from "../../components/ui/InfoHint";

/**
 * 设置·样式（FR-STYLE-2）：只改正文渲染的 `--md-*` 变量，不动外壳配色。
 * 全局一套，改完即时生效并记住；「恢复默认」把它们从根节点摘掉，交回 tokens。
 *
 * 两处刻意的实现细节：
 * 1. 数字输入走「草稿」状态——直接按解析值回写会让「1」这种中间态被范围校验丢掉，
 *    表现成「只能继承、打不进数字」。现在先把键入文本留在本地，合法才即时生效，失焦再收敛。
 * 2. 加粗字号允许留空 = 继承正文（`1em`），旁边常驻一个「继承正文」一键还原。
 */

type RowId = "body" | "h1" | "h2" | "h3" | "strong";

interface StyleRow {
  id: RowId;
  label: string;
  kind: "body" | "heading" | "strong";
  /** 字号范围（像素），以及 token 给不出数字时的兜底值。 */
  min: number;
  max: number;
  fallbackSize: number | null;
  /** 留空即继承正文字号（只有加粗支持）。 */
  allowInherit: boolean;
}

const ROWS: StyleRow[] = [
  { id: "body", label: "正文", kind: "body", min: 12, max: 22, fallbackSize: 14, allowInherit: false },
  { id: "h1", label: "一级标题", kind: "heading", min: 12, max: 64, fallbackSize: 32, allowInherit: false },
  { id: "h2", label: "二级标题", kind: "heading", min: 12, max: 48, fallbackSize: 14, allowInherit: false },
  { id: "h3", label: "三级标题", kind: "heading", min: 12, max: 48, fallbackSize: 14, allowInherit: false },
  { id: "strong", label: "加粗", kind: "strong", min: 10, max: 40, fallbackSize: null, allowInherit: true },
];

const COLOR_PRESETS = [
  { value: "var(--app-fg)", label: "正文色" },
  { value: "var(--app-fg-muted)", label: "次要色" },
  { value: "var(--app-fg-subtle)", label: "弱化色" },
  { value: "var(--app-accent)", label: "强调橙" },
  { value: "var(--app-accent-fg)", label: "橙（深）" },
  { value: "var(--app-link)", label: "链接蓝" },
  { value: "var(--app-success)", label: "成功绿" },
];

const WEIGHTS = [
  { value: "300", label: "细 300" },
  { value: "400", label: "常规 400" },
  { value: "500", label: "中等 500" },
  { value: "600", label: "半粗 600" },
  { value: "700", label: "粗体 700" },
  { value: "800", label: "特粗 800" },
];

const RULE_WIDTHS = ["1px", "2px", "3px", "4px"].map((value) => ({ value, label: value.replace("px", " 号") }));

const RULE_LENGTHS = [
  { value: "0", label: "齐平" },
  { value: "0.35rem", label: "略长" },
  { value: "0.75rem", label: "标准" },
  { value: "1.25rem", label: "舒展" },
  { value: "2rem", label: "较长" },
  { value: "3rem", label: "很长" },
];

const RULE_OPACITIES = [
  { value: "1", label: "不透明" },
  { value: "0.8", label: "80%" },
  { value: "0.6", label: "60%" },
  { value: "0.4", label: "40%" },
  { value: "0.25", label: "25%" },
];

const RULE_COLORS = [
  { value: "var(--app-accent)", label: "强调橙" },
  { value: "var(--app-fg)", label: "文字色" },
  { value: "var(--app-fg-subtle)", label: "弱化色" },
  { value: "var(--app-border)", label: "边框色" },
];

const BODY_LEADINGS = [1.5, 1.6, 1.78, 1.9, 2];

/** token 里字号可能是 rem / 倍数，输入框只认像素数。 */
function sizeInPx(value: string, fallback: number): number {
  const rem = /^([\d.]+)rem$/.exec(value);
  if (rem) return Math.round(Number(rem[1]) * 16);
  const px = /^([\d.]+)px$/.exec(value);
  if (px) return Math.round(Number(px[1]));
  const em = /^([\d.]+)em$/.exec(value);
  if (em) return Math.round(Number(em[1]) * fallback);
  return fallback;
}

/** 切到「自定义颜色」时的起点：按当前主题给一个能看清的值，避免白底白字。 */
function themeDefaultColor(): string {
  return document.documentElement.dataset.theme === "dark" ? "#e9ebed" : "#1a1a18";
}

export function StyleSection({ userId }: { userId: string }) {
  const [vars, setVars] = useState<DocStyleVars>(effectiveDocStyle);
  useEffect(() => {
    const refresh = () => setVars(effectiveDocStyle());
    window.addEventListener("menote:appearance", refresh);
    return () => window.removeEventListener("menote:appearance", refresh);
  }, []);
  /** 正在键入、还没收敛成合法值的文本；键是控件标识。 */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const read = (key: string) => vars[key] ?? DOC_STYLE_DEFAULTS[key] ?? "";

  const update = (patch: DocStyleVars) => {
    setVars((previous) => ({ ...previous, ...patch }));
    updateDocStyle(patch);
    void updateAppearance(userId, { docStyle: { ...effectiveDocStyle(), ...patch } });
  };

  const setDraft = (key: string, value: string) => setDrafts((previous) => ({ ...previous, [key]: value }));
  const clearDraft = (key: string) => setDrafts((previous) => {
    const next = { ...previous };
    delete next[key];
    return next;
  });

  const setUnderline = (row: StyleRow, on: boolean) => {
    if (row.kind === "strong") { update({ "--md-strong-rule": on ? "underline" : "none" }); return; }
    update({
      [`--md-${row.id}-rule`]: on ? "block" : "none",
      [`--md-${row.id}-rule-pad`]: on ? "var(--md-heading-rule-gap)" : "var(--app-zero)",
    });
  };

  /** 字号：键入时合法就即时生效，失焦再夹到范围内；留空表示继承正文字号。 */
  const changeSize = (row: StyleRow, text: string) => {
    setDraft(`${row.id}-size`, text);
    if (!text.trim()) {
      if (row.allowInherit) update({ [`--md-${row.id}-size`]: "1em" });
      return;
    }
    const value = Number(text);
    if (Number.isFinite(value) && value >= row.min && value <= row.max) {
      update({ [`--md-${row.id}-size`]: `${Math.round(value)}px` });
    }
  };

  const commitSize = (row: StyleRow, text: string) => {
    clearDraft(`${row.id}-size`);
    if (!text.trim()) {
      if (row.allowInherit) update({ [`--md-${row.id}-size`]: "1em" });
      return;
    }
    const value = Number(text);
    if (!Number.isFinite(value)) return;
    const clamped = Math.min(row.max, Math.max(row.min, Math.round(value)));
    update({ [`--md-${row.id}-size`]: `${clamped}px` });
  };

  const reset = () => {
    resetDocStyle();
    void updateAppearance(userId, { docStyle: {} });
    setVars({ ...DOC_STYLE_DEFAULTS });
    setDrafts({});
  };

  const sizeText = (row: StyleRow) => {
    const draft = drafts[`${row.id}-size`];
    if (draft !== undefined) return draft;
    const raw = read(`--md-${row.id}-size`);
    if (raw === "1em") return "";
    return String(sizeInPx(raw, row.fallbackSize ?? 14));
  };

  return (
    <div>
      <div className="mn-setrow">
        <div>
          <p className="mn-setlabel">文档样式<InfoHint>
            只影响正文渲染，不改界面配色；即时生效、不进 Markdown，数字可手填，留空即继承正文。
          </InfoHint></p>
        </div>
        <button type="button" className="mn-textbtn" onClick={reset}>恢复默认</button>
      </div>

      {ROWS.map((row) => {
        const weightKey = `--md-${row.id}-weight`;
        const colorKey = `--md-${row.id}-color`;
        const ruleKey = row.kind === "strong" ? "--md-strong-rule" : `--md-${row.id}-rule`;
        const color = read(colorKey);
        const preset = COLOR_PRESETS.some((entry) => entry.value === color);
        const inherits = row.allowInherit && read(`--md-${row.id}-size`) === "1em";
        return (
          <div className="mn-stylerow" key={row.id}>
            <span className="mn-styllabel">{row.label}</span>
            <label className="mn-stylefield">字号
              <input
                type="number" min={row.min} max={row.max} step={1}
                aria-label={`${row.label}字号`}
                value={sizeText(row)}
                placeholder={row.allowInherit ? "继承" : undefined}
                onChange={(event) => changeSize(row, event.target.value)}
                onBlur={(event) => commitSize(row, event.target.value)}
              />
            </label>
            {row.allowInherit && !inherits && (
              <button type="button" className="mn-styleinherit"
                onClick={() => { clearDraft(`${row.id}-size`); update({ [`--md-${row.id}-size`]: "1em" }); }}>
                继承正文
              </button>
            )}
            {row.kind === "body" && (
              <label className="mn-stylefield">行高
                <input
                  type="number" min={1.2} max={2.4} step={0.02}
                  aria-label="正文行高"
                  value={drafts["body-leading"] ?? read("--md-body-leading")}
                  onChange={(event) => {
                    const text = event.target.value;
                    setDraft("body-leading", text);
                    const value = Number(text);
                    if (Number.isFinite(value) && value >= 1.2 && value <= 2.4) update({ "--md-body-leading": text });
                  }}
                  onBlur={(event) => {
                    clearDraft("body-leading");
                    const value = Number(event.target.value);
                    if (!Number.isFinite(value)) return;
                    update({ "--md-body-leading": String(Math.min(2.4, Math.max(1.2, value))) });
                  }}
                />
              </label>
            )}
            <label className="mn-stylefield">字重
              <select aria-label={`${row.label}字重`} value={read(weightKey) || "400"} onChange={(event) => update({ [weightKey]: event.target.value })}>
                {WEIGHTS.map((weight) => <option key={weight.value} value={weight.value}>{weight.label}</option>)}
              </select>
            </label>
            <label className="mn-stylefield">颜色
              <select
                aria-label={`${row.label}颜色`}
                value={preset ? color : "custom"}
                onChange={(event) => update({ [colorKey]: event.target.value === "custom" ? themeDefaultColor() : event.target.value })}
              >
                {COLOR_PRESETS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                <option value="custom">自定义</option>
              </select>
            </label>
            {!preset && (
              <input
                type="color" className="mn-stylecolor" aria-label={`${row.label}自定义颜色`}
                value={color} onChange={(event) => update({ [colorKey]: event.target.value })}
              />
            )}
            {row.kind !== "body" && (
              <label className="mn-stylecheck">
                <input
                  type="checkbox"
                  checked={read(ruleKey) !== "none"}
                  onChange={(event) => setUnderline(row, event.target.checked)}
                />
                下划线
              </label>
            )}
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
        <label className="mn-stylefield">透明度
          <select aria-label="装饰线透明度" value={read("--md-heading-rule-opacity")} onChange={(event) => update({ "--md-heading-rule-opacity": event.target.value })}>
            {RULE_OPACITIES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </select>
        </label>
        <label className="mn-stylefield">颜色
          <select aria-label="装饰线颜色" value={read("--md-heading-rule-color")} onChange={(event) => update({ "--md-heading-rule-color": event.target.value })}>
            {RULE_COLORS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </select>
        </label>
      </div>

      <datalist id="mn-body-leadings">
        {BODY_LEADINGS.map((value) => <option key={value} value={value} />)}
      </datalist>

      <div className="mn-stylepreview markdown-content" aria-label="样式预览">
        <h1>一级标题</h1>
        <h2>二级标题</h2>
        <h3>三级标题</h3>
        <p>正文示例：这里有一段<strong>加粗文字</strong>，用来看字号、字重、颜色与下划线。</p>
      </div>
    </div>
  );
}
