import { useState, type FormEvent } from "react";
import { MEMORY_FIELDS, MEMORY_LIMITS, type MemoryScope } from "@menote/shared";
import { newId } from "../../lib/hash";

export function MemoryRowForm({ onSave, onClose }: { onSave: (values: Record<string, string>) => void; onClose: () => void }) {
  const [scope, setScope] = useState<MemoryScope>("personal");
  const [invalid, setInvalid] = useState(false);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const text = (name: string) => String(values.get(name) ?? "").replace(/[\r\n]+/g, " ").trim();
    const title = text("title");
    const value = text("value");
    const source = text("source");
    if (!title || !value || !source) { setInvalid(true); return; }
    onSave({ [MEMORY_FIELDS.scope.name]: scope, [MEMORY_FIELDS.project_id.name]: text("project_id"),
      [MEMORY_FIELDS.key.name]: text("key"), [MEMORY_FIELDS.title.name]: title, [MEMORY_FIELDS.value.name]: value,
      [MEMORY_FIELDS.source.name]: source, [MEMORY_FIELDS.status.name]: "active", [MEMORY_FIELDS.id.name]: newId() });
  }

  return <form className="mn-memory-row-form mn-settings-card" aria-label="新建记忆" onSubmit={save}>
    <label>范围<select className="mn-propselect" value={scope} onChange={(event) => setScope(event.target.value as MemoryScope)}>
      <option value="personal">个人</option><option value="project">项目</option>
    </select></label>
    {scope === "project" && <label>项目标识<input className="mn-propinput" name="project_id" required maxLength={MEMORY_LIMITS.project} pattern="[a-z0-9]+(?:\x2D[a-z0-9]+)*" /></label>}
    <label>记忆键<input className="mn-propinput" name="key" required maxLength={MEMORY_LIMITS.key} pattern="[a-z0-9]+(?:[.\x2D][a-z0-9]+)*" /></label>
    <label>记忆项<input className="mn-propinput" name="title" required maxLength={MEMORY_LIMITS.title} /></label>
    <label>当前内容<textarea className="mn-propinput" name="value" required maxLength={MEMORY_LIMITS.value} /></label>
    <label>依据<input className="mn-propinput" name="source" required maxLength={MEMORY_LIMITS.source} /></label>
    {invalid && <p className="mn-tabledoc-error" role="alert">请填写记忆项、当前内容和依据。</p>}
    <div className="mn-setrow"><button className="mn-auth-submit" type="submit">添加记忆</button>
      <button className="mn-textbtn" type="button" onClick={onClose}>取消</button></div>
  </form>;
}
