import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import type { PropertyTemplate, PropertyType } from "../../lib/frontmatter";
import { PROPERTY_TYPES, parseOptionList } from "../../lib/frontmatter";
import {
  DEFAULT_PROPERTY_TEMPLATES, readPropertyTemplates, savePropertyTemplates,
} from "../../services/propertyTemplateService";

const TYPE_LABELS: Record<PropertyType, string> = {
  text: "文本",
  multiline: "多行文本",
  number: "数字",
  date: "日期",
  select: "单选",
  multiselect: "多选",
  checkbox: "复选框",
  link: "链接",
};

/** 按组归拢（组内保持原顺序；无组的排在最后）。 */
function groupTemplates(templates: PropertyTemplate[]): Array<{ group: string; items: PropertyTemplate[] }> {
  const groups = new Map<string, PropertyTemplate[]>();
  for (const template of templates) {
    const key = template.group ?? "其它";
    const list = groups.get(key) ?? [];
    list.push(template);
    groups.set(key, list);
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items }));
}

/**
 * 默认属性设置（FR-PROP-9）：这里配的预设是「添加属性」的模板库，随账号同步。
 * 预设改动只影响之后添加的属性；已经加进文档的属性就是该文档自己的设定，不受影响。
 */
export function PropertyTemplatePanel({ userId }: { userId: string }) {
  const [templates, setTemplates] = useState<PropertyTemplate[] | null>(null);
  const [draft, setDraft] = useState<PropertyTemplate | null>(null);
  const grouped = useMemo(() => (templates ? groupTemplates(templates) : []), [templates]);

  useEffect(() => {
    let cancelled = false;
    void readPropertyTemplates(userId).then((list) => { if (!cancelled) setTemplates(list); });
    return () => { cancelled = true; };
  }, [userId]);

  if (!templates) return <p className="mn-sethint">设置加载中…</p>;

  const persist = (next: PropertyTemplate[]) => {
    setTemplates(next);
    void savePropertyTemplates(userId, next);
  };

  return (
    <div>
      <div className="mn-setrow">
        <div>
          <p className="mn-setlabel">默认属性预设</p>
          <p className="mn-sethint">
            添加属性时可以直接挑这里的预设，省去每次手填键名、类型与候选值。预设随账号同步；
            改动只影响之后添加的属性，已经加进文档的属性不受影响，文档里的增删改也不会反写这里。
            <br />
            键名是可互通的机器名（英文惯例 / Raindrop 标准列名），中文只作显示名——
            导到 Obsidian 不用改键，接 Raindrop 的表也能被连接器认出。
          </p>
        </div>
      </div>
      {grouped.map(({ group, items }) => (
        <div key={group} className="mn-templategroup">
          <p className="mn-templategroup-label">{group}</p>
          <div className="mn-templatelist">
            {items.map((template) => (
              <div key={template.id} className="mn-templaterow">
                <span className="mn-templaterow-name">{template.label ?? template.name}</span>
                <code className="mn-templaterow-key">{template.name}</code>
                <span className="mn-templaterow-type">{TYPE_LABELS[template.type]}</span>
                {template.options && template.options.length > 0 && (
                  <span className="mn-templaterow-options" title={template.options.join("、")}>
                    {template.options.join("、")}
                  </span>
                )}
                <button type="button" className="mn-iconbtn mn-templaterow-del" aria-label={`删除预设 ${template.name}`}
                  onClick={() => persist(templates.filter((row) => row.id !== template.id))}>
                  <X />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
      {templates.length === 0 && <p className="mn-sethint">还没有预设。下面的出厂预设可以一键恢复。</p>}
      <div className="mn-templateform">
        <input className="mn-propinput mn-templateform-key" placeholder="键名（如 status）" aria-label="预设键名" value={draft?.name ?? ""}
          onChange={(event) => setDraft({ ...(draft ?? { id: "", type: "text" }), name: event.target.value })} />
        <input className="mn-propinput mn-templateform-label" placeholder="显示名（可选）" aria-label="预设显示名" value={draft?.label ?? ""}
          onChange={(event) => setDraft({ ...(draft ?? { id: "", type: "text", name: "" }), label: event.target.value })} />
        <select className="mn-propselect" aria-label="预设类型" value={draft?.type ?? "text"}
          onChange={(event) => setDraft({ ...(draft ?? { id: "", name: "" }), type: event.target.value as PropertyType })}>
          {PROPERTY_TYPES.map((option) => <option key={option} value={option}>{TYPE_LABELS[option]}</option>)}
        </select>
        <input className="mn-propinput mn-templateform-group" placeholder="分组（可选）" aria-label="预设分组" value={draft?.group ?? ""}
          onChange={(event) => setDraft({ ...(draft ?? { id: "", name: "", type: "text" }), group: event.target.value })} />
        {(draft?.type === "select" || draft?.type === "multiselect") && (
          <textarea className="mn-proptextarea" rows={3} placeholder="候选值：每行一个，或用分号分隔" aria-label="预设候选值"
            value={(draft?.options ?? []).join("\n")}
            onChange={(event) => setDraft({ ...(draft ?? { id: "", name: "", type: "select" }), options: parseOptionList(event.target.value) })} />
        )}
        <div className="mn-proprow-actions">
          <button type="button" className="mn-textbtn" onClick={() => {
            const name = draft?.name?.trim();
            if (!name) return;
            persist([...templates, { ...(draft as PropertyTemplate), id: draft?.id || `tpl-${Date.now()}`, name }]);
            setDraft(null);
          }}><Plus /> 添加预设</button>
          <button type="button" className="mn-textbtn" onClick={() => persist([...DEFAULT_PROPERTY_TEMPLATES])}>恢复出厂预设</button>
        </div>
      </div>
    </div>
  );
}
