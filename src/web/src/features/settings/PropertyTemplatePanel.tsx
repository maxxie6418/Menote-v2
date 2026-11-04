import { useEffect, useMemo, useState } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import type { PropertyTemplate, PropertyType } from "../../lib/frontmatter";
import { PROPERTY_TYPES, parseOptionList } from "../../lib/frontmatter";
import {
  DEFAULT_PROPERTY_TEMPLATES, readPropertyTemplates, savePropertyTemplates,
} from "../../services/propertyTemplateService";
import { ContextMenu } from "../../components/ui/ContextMenu";
import { groupTemplates, TYPE_LABELS } from "../props";

interface Draft {
  name: string;
  label: string;
  type: PropertyType;
  group: string;
  options: string;
}

const EMPTY_DRAFT: Draft = { name: "", label: "", type: "text", group: "", options: "" };

function draftOf(template: PropertyTemplate): Draft {
  return {
    name: template.name,
    label: template.label ?? "",
    type: template.type,
    group: template.group ?? "",
    options: (template.options ?? []).join("\n"),
  };
}

/**
 * 默认属性设置（FR-PROP-9）：这里配的预设是「添加属性」的模板库，随账号同步。
 * 预设改动只影响之后添加的属性；已经加进文档的属性就是该文档自己的设定，不受影响。
 *
 * 版式按表来：列头 + 同一套栅格，行内 ⋯ 编辑/删除，新建是列表末行的一张同款表单，
 * 底部操作条常驻；「恢复出厂」是破坏性操作，先出确认再覆盖。
 */
export function PropertyTemplatePanel({ userId }: { userId: string }) {
  const [templates, setTemplates] = useState<PropertyTemplate[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const grouped = useMemo(() => (templates ? groupTemplates(templates) : []), [templates]);

  useEffect(() => {
    let cancelled = false;
    void readPropertyTemplates(userId).then((list) => { if (!cancelled) setTemplates(list); });
    return () => { cancelled = true; };
  }, [userId]);

  if (!templates) return <p className="mn-sethint">设置加载中…</p>;

  const persist = (next: PropertyTemplate[]) => {
    setTemplates(next);
    setEditingId(null);
    setCreating(false);
    setDraft(EMPTY_DRAFT);
    setError(null);
    void savePropertyTemplates(userId, next);
  };

  const startEdit = (template: PropertyTemplate) => {
    setEditingId(template.id);
    setCreating(false);
    setDraft(draftOf(template));
    setError(null);
  };

  const startCreate = () => {
    setCreating(true);
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
  };

  const submit = () => {
    const name = draft.name.trim();
    if (!name) { setError("键名不能为空"); return; }
    const taken = templates.some((template) => template.name === name && template.id !== editingId);
    if (taken) { setError(`键名「${name}」已在预设里`); return; }
    const needsOptions = draft.type === "select" || draft.type === "multiselect";
    const options = parseOptionList(draft.options);
    if (needsOptions && options.length === 0) { setError("单选 / 多选至少要有一个候选值"); return; }
    const label = draft.label.trim();
    const group = draft.group.trim();
    const next: PropertyTemplate = {
      id: editingId ?? `tpl-${Date.now()}`,
      name,
      type: draft.type,
      ...(label ? { label } : {}),
      ...(needsOptions ? { options } : {}),
      ...(group ? { group } : {}),
      ...(editingId ? { value: templates.find((template) => template.id === editingId)?.value } : {}),
    };
    persist(editingId
      ? templates.map((template) => (template.id === editingId ? next : template))
      : [...templates, next]);
  };

  const form = (isNew: boolean) => {
    const needsOptions = draft.type === "select" || draft.type === "multiselect";
    return (
      <div className="mn-tpl-edit">
        <div className="mn-tpl-form">
          <label className="mn-tpl-field">
            <span>显示名</span>
            <input className="mn-propinput" value={draft.label} placeholder="状态" autoFocus
              onChange={(event) => { setDraft({ ...draft, label: event.target.value }); setError(null); }} />
          </label>
          <label className="mn-tpl-field">
            <span>键名</span>
            <input className="mn-propinput" value={draft.name} placeholder="status"
              onChange={(event) => { setDraft({ ...draft, name: event.target.value }); setError(null); }} />
          </label>
          <label className="mn-tpl-field">
            <span>类型</span>
            <select className="mn-propselect" value={draft.type}
              onChange={(event) => { setDraft({ ...draft, type: event.target.value as PropertyType }); setError(null); }}>
              {PROPERTY_TYPES.map((option) => <option key={option} value={option}>{TYPE_LABELS[option]}</option>)}
            </select>
          </label>
          <label className="mn-tpl-field">
            <span>分组</span>
            <input className="mn-propinput" value={draft.group} placeholder="通用"
              onChange={(event) => setDraft({ ...draft, group: event.target.value })} />
          </label>
          {needsOptions && (
            <label className="mn-tpl-field mn-tpl-field-wide">
              <span>候选值（每行一个，或用分号、逗号分隔）</span>
              <textarea className="mn-proptextarea" rows={4} value={draft.options}
                placeholder="未开始 / 进行中 / 已完成"
                onChange={(event) => { setDraft({ ...draft, options: event.target.value }); setError(null); }} />
            </label>
          )}
        </div>
        {error && <p className="mn-proppop-error" role="alert">{error}</p>}
        <div className="mn-tpl-formactions">
          <button type="button" className="mn-propbtn" onClick={() => { setEditingId(null); setCreating(false); setError(null); }}>取消</button>
          <button type="button" className="mn-propbtn mn-propbtn-primary" onClick={submit}>{isNew ? "创建" : "保存"}</button>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="mn-setrow">
        <div>
          <p className="mn-setlabel">默认属性预设</p>
          <p className="mn-sethint">
            添加属性时可直接选用；改动只影响之后添加的属性，已经加进文档的不受影响。
            <details className="mn-setdetails">
              <summary>为什么键名用英文？</summary>
              <p>
                键名是可互通的机器名：Raindrop 组沿用连接器写死的标准列名，其余沿用 Obsidian 社区惯例。
                中文只作显示名，导出到 Obsidian 不用改键。
              </p>
            </details>
          </p>
        </div>
      </div>

      <div className="mn-tpl">
        <div className="mn-tpl-thead">
          <span>显示名</span><span>键名</span><span>类型</span><span>候选值</span><span />
        </div>

        {grouped.map(({ group, items }) => (
          <div key={group} className="mn-tpl-group">
            <p className="mn-tpl-groupname">{group}</p>
            {items.map((template) => (
              <div key={template.id}>
                <div className="mn-tpl-row">
                  <span className="mn-tpl-name">{template.label ?? template.name}</span>
                  <code className="mn-tpl-key">{template.name}</code>
                  <span className="mn-tpl-type">{TYPE_LABELS[template.type]}</span>
                  <span className="mn-tpl-options" title={template.options?.join(" / ")}>
                    {template.options?.length ? template.options.join(" / ") : "—"}
                  </span>
                  <button
                    type="button" className="mn-tpl-more" aria-label={`预设操作：${template.name}`} title="更多"
                    aria-expanded={menu?.id === template.id}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setMenu(menu?.id === template.id ? null : { id: template.id, x: rect.right, y: rect.bottom });
                    }}
                  >
                    <MoreHorizontal aria-hidden />
                  </button>
                </div>
                {editingId === template.id && form(false)}
              </div>
            ))}
          </div>
        ))}

        {templates.length === 0 && (
          <p className="mn-sethint mn-tpl-empty">还没有预设。新建一条，或恢复出厂预设。</p>
        )}
        {creating && form(true)}

        <div className="mn-tpl-foot">
          {!creating && (
            <button type="button" className="mn-propbtn" onClick={startCreate}>
              <Plus aria-hidden />新建预设
            </button>
          )}
          <span className="mn-tpl-footright">
            {confirmReset ? (
              <span className="mn-tpl-confirm">
                恢复出厂会覆盖当前 {templates.length} 条预设
                <button type="button" className="mn-propbtn" onClick={() => {
                  persist(DEFAULT_PROPERTY_TEMPLATES.map((template) => ({ ...template })));
                  setConfirmReset(false);
                }}>确认恢复</button>
                <button type="button" className="mn-tpl-quiet" onClick={() => setConfirmReset(false)}>取消</button>
              </span>
            ) : (
              <button type="button" className="mn-tpl-quiet" onClick={() => setConfirmReset(true)}>恢复出厂预设</button>
            )}
          </span>
        </div>
      </div>

      {menu && (
        <ContextMenu
          x={menu.x} y={menu.y} label="预设操作"
          actions={[
            {
              label: "编辑",
              onSelect: () => {
                const template = templates.find((entry) => entry.id === menu.id);
                if (template) startEdit(template);
              },
            },
            {
              label: "删除",
              destructive: true,
              separatorBefore: true,
              onSelect: () => persist(templates.filter((entry) => entry.id !== menu.id)),
            },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
