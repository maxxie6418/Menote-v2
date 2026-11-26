import { useEffect, useState } from "react";
import { InfoHint } from "../../components/ui/InfoHint";
import { getPropsPlacement, getToolbarPlacement, resolveToolbar, setPropsPlacement, setToolbarPlacement, type PropsPlacement, type ToolbarPlacement } from "../../lib/docLayout";
import { readAppearance, updateAppearance } from "../../services/appearanceSettingsService";
import { SettingsGroup } from "./SettingsGroup";

export function EditorSection({ userId, onOpenTemplates }: { userId: string; onOpenTemplates: () => void }) {
  const [propsPos, setPropsPos] = useState<PropsPlacement>(getPropsPlacement);
  const [toolbar, setToolbar] = useState<ToolbarPlacement>(getToolbarPlacement);
  useEffect(() => {
    let active = true;
    const refresh = () => { void readAppearance(userId).then((value) => {
      if (!active || !value) return;
      setPropsPos(value.propsPos);
      setToolbar(value.toolbar);
    }); };
    refresh();
    window.addEventListener("menote:appearance", refresh);
    return () => { active = false; window.removeEventListener("menote:appearance", refresh); };
  }, [userId]);

  return (
    <div className="mn-settings-stack">
      <SettingsGroup title="笔记布局">
        <div className="mn-setrow">
          <div>
            <p className="mn-setlabel">属性显示位置<InfoHint>顶部：属性在标题与正文之间（项目现状）。侧边：属性移到纸面右侧页边注，窄窗口或移动端会自动落回顶部。</InfoHint></p>
          </div>
          <select
            className="mn-propselect"
            aria-label="属性显示位置"
            value={propsPos}
            onChange={(event) => {
              const value = event.target.value as PropsPlacement;
              setPropsPlacement(value);
              setPropsPos(value);
              void updateAppearance(userId, { propsPos: value });
            }}
          >
            <option value="top">顶部（标题下方）</option>
            <option value="side">侧边（页边注）</option>
          </select>
        </div>
        <div className="mn-setrow">
          <div>
            <p className="mn-setlabel">编辑工具栏<InfoHint>当前显示为「{resolveToolbar() === "bottom" ? "底部浮动" : "顶部固定"}」。</InfoHint></p>
          </div>
          <select
            className="mn-propselect"
            aria-label="编辑工具栏"
            value={toolbar}
            onChange={(event) => {
              const value = event.target.value as ToolbarPlacement;
              setToolbarPlacement(value);
              setToolbar(value);
              void updateAppearance(userId, { toolbar: value });
            }}
          >
            <option value="auto">跟随主题</option>
            <option value="top">顶部固定</option>
            <option value="bottom">底部浮动</option>
          </select>
        </div>
      </SettingsGroup>
      <SettingsGroup title="布局预览">
        <div className={"mn-appearance-preview-frame" + (document.documentElement.dataset.rail === "rail" ? " is-rail" : "") + (propsPos === "side" ? " has-side-props" : "") + (resolveToolbar() === "bottom" ? " has-bottom-toolbar" : "")}
          data-skin={document.documentElement.dataset.skin} aria-hidden="true">
          <div className="mn-appearance-preview-top"><i /><i /><i /><i /></div>
          <div className="mn-appearance-preview-cols">
            <div className="mn-appearance-preview-nav"><i /><i /><i /><i /></div>
            <div className="mn-appearance-preview-list"><i /><i /><i /><i /></div>
            <div className="mn-appearance-preview-paper"><i className="is-heading" /><i /><i /><i className="is-short" /><i />{propsPos === "side" && <i className="is-props" />}</div>
          </div>
          <div className="mn-appearance-preview-toolbar"><i /><i /><i /></div>
        </div>
      </SettingsGroup>
      <SettingsGroup title="新建笔记">
        <div className="mn-setrow">
          <div><p className="mn-setlabel">默认属性</p><p className="mn-sethint">设置新建笔记时使用的属性模板。</p></div>
          <button type="button" className="mn-textbtn mn-settings-outline" onClick={onOpenTemplates}>管理默认属性</button>
        </div>
      </SettingsGroup>
    </div>
  );
}
