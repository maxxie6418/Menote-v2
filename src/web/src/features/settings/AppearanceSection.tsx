import { useEffect, useState } from "react";
import { InfoHint } from "../../components/ui/InfoHint";
import { getThemeMode, setThemeMode, subscribeTheme, type ThemeMode } from "../../lib/theme";
import { getFontPreference, setFontPreference, type FontPreference } from "../../lib/fontPreference";
import { getDensityPreference, setDensityPreference, type DensityPreference } from "../../lib/density";
import { getMeasurePreference, setMeasurePreference, type MeasurePreference } from "../../lib/measurePreference";
import { getThemeSkin, setThemeSkin, type ThemeSkin } from "../../lib/themeSkin";
import { readAppearance, updateAppearance } from "../../services/appearanceSettingsService";
import { SettingsGroup } from "./SettingsGroup";

const THEME_OPTIONS: ReadonlyArray<{ mode: ThemeMode; label: string }> = [
  { mode: "system", label: "跟随系统" },
  { mode: "light", label: "浅色" },
  { mode: "dark", label: "深色" },
];

/** 外观节：界面主题、字体、阅读宽度、属性位置与工具栏位置。
 *  偏好分别经 lib/themeSkin、lib/fontPreference、lib/measurePreference、lib/docLayout 即时生效。 */
export function AppearanceSection({ userId, onOpenStyles }: { userId: string; onOpenStyles: () => void }) {
  const [theme, setTheme] = useState(getThemeMode);
  useEffect(() => subscribeTheme(() => setTheme(getThemeMode())), []);
  const [skin, setSkin] = useState<ThemeSkin>(getThemeSkin);
  const [font, setFont] = useState<FontPreference>(getFontPreference);
  const [density, setDensity] = useState<DensityPreference>(getDensityPreference);
  const [measure, setMeasure] = useState<MeasurePreference>(getMeasurePreference);
  const [railMode, setRailMode] = useState<"bar" | "rail">(() => document.documentElement.dataset.rail === "rail" ? "rail" : "bar");
  const [memoWorkbarSide, setMemoWorkbarSide] = useState<"left" | "right">(() => document.documentElement.dataset.memoWorkbarSide === "right" ? "right" : "left");
  const [memoTodoDefault, setMemoTodoDefault] = useState<"open" | "closed">(() => document.documentElement.dataset.memoTodoDefault === "closed" ? "closed" : "open");
  useEffect(() => {
    const refresh = () => { void readAppearance(userId).then((value) => {
      if (!value) return;
      if (value.skin) setSkin(value.skin);
      if (value.font) setFont(value.font);
      if (value.density) setDensity(value.density);
      if (value.measure) setMeasure(value.measure);
      setRailMode(value.railMode ?? "bar");
      setMemoWorkbarSide(value.memoWorkbarSide ?? "left");
      setMemoTodoDefault(value.memoTodoDefault ?? "open");
    }); };
    refresh();
    window.addEventListener("menote:appearance", refresh);
    return () => window.removeEventListener("menote:appearance", refresh);
  }, [userId]);
  return (
    <div className="mn-settings-stack">
      <SettingsGroup title="界面">
        <div className="mn-setrow">
          <div><p className="mn-setlabel">明暗模式</p><p className="mn-sethint">可跟随系统，也可为 Menote 单独选择。</p></div>
          <div className="mn-settings-segments" role="group" aria-label="明暗模式">
            {THEME_OPTIONS.map(({ mode, label }) => <button type="button" key={mode} aria-pressed={theme === mode}
              onClick={() => { setThemeMode(mode); void updateAppearance(userId, { theme: mode }); }}>{label}</button>)}
          </div>
        </div>
        <div className="mn-setrow">
          <div>
            <p className="mn-setlabel">界面主题<InfoHint>皮肤与浅色、深色模式可独立选择。外观偏好即时生效并随账号同步。</InfoHint></p>
          </div>
            <select className="mn-propselect" aria-label="界面主题" value={skin} onChange={(event) => {
              const value = event.target.value as ThemeSkin;
              setThemeSkin(value); setSkin(value); void updateAppearance(userId, { skin: value });
            }}>
              <option value="shadcn">shadcn/ui（默认）</option><option value="slate">素灰</option><option value="ink">墨台</option>
            </select>
        </div>
        <div className="mn-setrow">
          <div>
            <p className="mn-setlabel">界面密度<InfoHint>整站按比例缩放：字号、间距、按钮与图标一起变，不是单独放大字号。高分屏觉得字小选「舒适」或「宽松」；窄屏想多放内容选「紧凑」。</InfoHint></p>
          </div>
          <select
            className="mn-propselect"
            aria-label="界面密度"
            value={density}
            onChange={(event) => {
              const value = event.target.value as DensityPreference;
              setDensityPreference(value);
              setDensity(value);
              void updateAppearance(userId, { density: value });
            }}
          >
            <option value="compact">紧凑（15px 基准）</option>
            <option value="standard">标准（16px 基准）</option>
            <option value="cozy">舒适（17px 基准）</option>
            <option value="spacious">宽松（18px 基准）</option>
          </select>
        </div>
        <div className="mn-setrow">
          <div>
            <p className="mn-setlabel">界面字体<InfoHint>默认使用内置的 Noto Sans SC（随应用分发，无需联网加载）；切换为系统字体后由设备决定渲染。</InfoHint></p>
          </div>
          <select
            className="mn-propselect"
            aria-label="界面字体"
            value={font}
            onChange={(event) => {
              const value = event.target.value as FontPreference;
              setFontPreference(value);
              setFont(value);
              void updateAppearance(userId, { font: value });
            }}
          >
            <option value="noto">Noto Sans SC（默认）</option>
            <option value="system">系统字体</option>
          </select>
        </div>
        <div className="mn-setrow">
          <div><p className="mn-setlabel">导航布局<InfoHint>完整侧栏显示主题与标签。书脊布局在笔记清单顶部显示主题与标签。窄屏使用抽屉。</InfoHint></p></div>
          <select className="mn-propselect" aria-label="导航布局" value={railMode} onChange={(event) => {
            const value = event.target.value as "bar" | "rail";
            setRailMode(value);
            void updateAppearance(userId, { railMode: value });
          }}><option value="bar">完整侧栏</option><option value="rail">书脊 + 清单导航</option></select>
        </div>
      </SettingsGroup>
      <SettingsGroup title="阅读排版">
        <div className="mn-setrow">
          <div>
            <p className="mn-setlabel">阅读宽度<InfoHint>跟随主题默认宽度；也可选窄、加宽或撑满，所选宽度在所有主题生效并覆盖主题默认值。</InfoHint></p>
          </div>
          <select
            className="mn-propselect"
            aria-label="阅读宽度"
            value={measure}
            onChange={(event) => {
              const value = event.target.value as MeasurePreference;
              setMeasurePreference(value);
              setMeasure(value);
              void updateAppearance(userId, { measure: value });
            }}
          >
            <option value="auto">跟随主题默认</option>
            <option value="narrow">窄</option>
            <option value="wide">加宽</option>
            <option value="full">撑满</option>
          </select>
        </div>
        <div className="mn-setrow">
          <div><p className="mn-setlabel">正文排版</p><p className="mn-sethint">配置正文和标题的字号、行高、字重与颜色。</p></div>
          <button type="button" className="mn-textbtn mn-settings-outline" onClick={onOpenStyles}>调整阅读排版</button>
        </div>
      </SettingsGroup>
      <SettingsGroup title="效果预览">
        <div className="mn-stylepreview markdown-content mn-settings-reading-preview" aria-label="阅读排版样张">
          <h2>夜读手记</h2>
          <p>把尚未成形的想法记成 <strong>Memo</strong>，需要展开时，再整理成一篇 Note。</p>
          <p>这是一段包含中文、English 和 <code>行内代码</code> 的示例。</p>
        </div>
      </SettingsGroup>
      <SettingsGroup title="Memo">
        <div className="mn-setrow">
          <div><p className="mn-setlabel">Memo 侧记栏位置<InfoHint>选择侧记栏位于时间轴的哪一侧。</InfoHint></p></div>
          <select className="mn-propselect" aria-label="Memo 侧记栏位置" value={memoWorkbarSide} onChange={(event) => {
            const value = event.target.value as "left" | "right";
            setMemoWorkbarSide(value);
            void updateAppearance(userId, { memoWorkbarSide: value });
          }}><option value="left">左侧</option><option value="right">右侧</option></select>
        </div>
        <div className="mn-setrow">
          <div><p className="mn-setlabel">Memo Todo 默认状态<InfoHint>控制进入 Memo 时 Todo 侧板默认展开或收起；之后仍可在页面中切换。</InfoHint></p></div>
          <select className="mn-propselect" aria-label="Memo Todo 默认状态" value={memoTodoDefault} onChange={(event) => {
            const value = event.target.value as "open" | "closed";
            setMemoTodoDefault(value);
            void updateAppearance(userId, { memoTodoDefault: value });
          }}><option value="open">展开</option><option value="closed">收起</option></select>
        </div>
      </SettingsGroup>
    </div>
  );
}
