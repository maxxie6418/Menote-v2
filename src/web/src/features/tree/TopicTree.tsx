import { useState } from "react";
import { Lock, Plus } from "lucide-react";
import { useTopics, type BrowseSection } from "../../services/contentHooks";
import { createTopic, renameTopic, softDeleteTopic } from "../../services/contentService";

interface TopicTreeProps {
  userId: string;
  selected: BrowseSection;
  onSelect: (section: BrowseSection) => void;
}

/** 目录树（FR-IA-1/3：只显示主题与分组；分组最多一层；私人空间固定入口，G7 提供解锁）。 */
export function TopicTree({ userId, selected, onSelect }: TopicTreeProps) {
  const topics = useTopics(userId);
  const active = topics.filter((row) => row.deletedAt === null);
  const roots = active.filter((row) => row.depth === 0 && !row.isEncSpace);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const submit = async () => {
    const clean = name.trim();
    if (!clean) { setCreating(false); return; }
    await createTopic(userId, clean);
    setName("");
    setCreating(false);
  };

  return (
    <div className="mn-tree" aria-label="主题与分组">
      <ul className="mn-tree-list">
        {roots.map((topic) => (
          <TopicNodeView
            key={topic.id} userId={userId} topic={topic}
            groups={active.filter((row) => row.depth === 1 && row.parentId === topic.id)}
            selected={selected} onSelect={onSelect}
          />
        ))}
        {roots.length === 0 && !creating && <li className="mn-tree-empty">暂无主题</li>}
      </ul>
      {creating ? (
        <input
          className="mn-tree-new" autoFocus placeholder="主题名称，回车确认" aria-label="新建主题"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void submit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
            if (event.key === "Escape") { setName(""); setCreating(false); }
          }}
        />
      ) : (
        <button type="button" className="mn-minibtn mn-tree-add" aria-label="新建主题" title="新建主题" onClick={() => setCreating(true)}>
          <Plus /> 新建主题
        </button>
      )}
      <a
        href="#" className="mn-treerow priv" aria-disabled="true"
        title="私人空间将在 M2 提供解锁"
        onClick={(event) => event.preventDefault()}
      >
        <Lock /> <span>私人空间</span> <span className="mn-locklabel">锁定</span>
      </a>
    </div>
  );
}

interface TopicNodeViewProps {
  userId: string;
  topic: { id: string; name: string; depth: 0 | 1 };
  groups: Array<{ id: string; name: string; depth: 0 | 1 }>;
  selected: BrowseSection;
  onSelect: (section: BrowseSection) => void;
}

function TopicNodeView({ userId, topic, groups, selected, onSelect }: TopicNodeViewProps) {
  const [addingGroup, setAddingGroup] = useState(false);
  const [name, setName] = useState("");
  const isSelected = selected.kind === "topic" && selected.id === topic.id;

  const submitGroup = async () => {
    const clean = name.trim();
    if (!clean) { setAddingGroup(false); return; }
    await createTopic(userId, clean, topic.id);
    setName("");
    setAddingGroup(false);
  };

  return (
    <li>
      <div className={isSelected ? "mn-treerow on" : "mn-treerow"}>
        <button type="button" className="mn-tree-label" onClick={() => onSelect({ kind: "topic", id: topic.id })}>
          {topic.name}
        </button>
        <button type="button" className="mn-minibtn" aria-label={`在「${topic.name}」下新建分组`} title="新建分组"
          onClick={() => setAddingGroup((value) => !value)}><Plus /></button>
      </div>
      {addingGroup && (
        <input
          className="mn-tree-new indent" autoFocus placeholder="分组名称，回车确认" aria-label="新建分组"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void submitGroup()}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submitGroup();
            if (event.key === "Escape") { setName(""); setAddingGroup(false); }
          }}
        />
      )}
      <ul className="mn-tree-sublist">
        {groups.map((group) => (
          <li key={group.id}>
            <button
              type="button"
              className={selected.kind === "topic" && selected.id === group.id ? "mn-treerow on" : "mn-treerow"}
              onClick={() => onSelect({ kind: "topic", id: group.id })}
            >
              {group.name}
            </button>
          </li>
        ))}
      </ul>
      {isSelected && (
        <span className="mn-tree-actions">
          <button type="button" className="mn-minibtn" aria-label="重命名" title="重命名"
            onClick={async () => {
              const next = window.prompt("重命名主题", topic.name);
              if (next && next.trim()) await renameTopic(userId, topic.id, next.trim());
            }}>改名</button>
          <button type="button" className="mn-minibtn" aria-label="删除主题" title="删除（移入回收站）"
            onClick={async () => {
              if (window.confirm(`删除主题「${topic.name}」？其下条目保留，可从回收站恢复。`)) {
                await softDeleteTopic(userId, topic.id);
                onSelect({ kind: "recent" });
              }
            }}>删除</button>
        </span>
      )}
    </li>
  );
}
