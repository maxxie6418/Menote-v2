import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { Lock, Plus } from "lucide-react";
import { useLockVersion, useTopics, type BrowseSection } from "../../services/contentHooks";
import { createTopic, renameTopic, softDeleteTopic } from "../../services/contentService";
import { isTopicUnlocked } from "../../services/keyringService";
import { lockPrivateSpace } from "../../services/privateSpaceService";
import { ContextMenu, type ContextMenuAction } from "../../components/ui/ContextMenu";

interface TopicTreeProps {
  userId: string;
  selected: BrowseSection;
  onSelect: (section: BrowseSection) => void;
  onOpenPrivate: () => void;
}

/** 目录树（FR-IA-1/3：只显示主题与分组；分组最多一层；私人空间固定入口，G7 提供解锁）。 */
export function TopicTree({ userId, selected, onSelect, onOpenPrivate }: TopicTreeProps) {
  useLockVersion();
  const topics = useTopics(userId);
  const active = topics.filter((row) => row.deletedAt === null);
  const space = active.find((row) => row.depth === 0 && row.isEncSpace);
  const spaceOpen = space ? isTopicUnlocked(space.id) : false;
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
      {space && spaceOpen ? (
        <ul className="mn-tree-list">
          <TopicNodeView
            userId={userId} topic={space} fixed
            groups={active.filter((row) => row.depth === 1 && row.parentId === space.id)}
            selected={selected} onSelect={onSelect}
            onLock={() => { void lockPrivateSpace(userId); onSelect({ kind: "recent" }); }}
          />
        </ul>
      ) : (
        <button type="button" className="mn-treerow priv" onClick={onOpenPrivate}>
          <Lock /> <span>私人空间</span> <span className="mn-locklabel">{space ? "锁定" : "未设置"}</span>
        </button>
      )}
    </div>
  );
}

interface TopicNodeViewProps {
  userId: string;
  topic: { id: string; name: string; depth: 0 | 1 };
  groups: Array<{ id: string; name: string; depth: 0 | 1 }>;
  selected: BrowseSection;
  onSelect: (section: BrowseSection) => void;
  fixed?: boolean;
  onLock?: () => void;
}

function TopicNodeView({ userId, topic, groups, selected, onSelect, fixed = false, onLock }: TopicNodeViewProps) {
  const [addingGroup, setAddingGroup] = useState(false);
  const [name, setName] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: { id: string; name: string; depth: 0 | 1 }; trigger: HTMLElement } | null>(null);
  const isSelected = selected.kind === "topic" && selected.id === topic.id;

  const closeContextMenu = () => setContextMenu(null);
  const setMenuAt = (x: number, y: number, target: { id: string; name: string; depth: 0 | 1 }, trigger: HTMLElement) => {
    setContextMenu({ x, y, target, trigger });
  };
  const openPointerMenu = (event: MouseEvent<HTMLElement>, target: { id: string; name: string; depth: 0 | 1 }) => {
    event.preventDefault();
    setMenuAt(event.clientX, event.clientY, target, event.target instanceof HTMLElement ? event.target : event.currentTarget);
  };
  const openKeyboardMenu = (event: KeyboardEvent<HTMLElement>, target: { id: string; name: string; depth: 0 | 1 }) => {
    if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    setMenuAt(bounds.left, bounds.bottom, target, event.target instanceof HTMLElement ? event.target : event.currentTarget);
  };

  const lockedRoot = fixed && contextMenu?.target.id === topic.id;
  const actions: ContextMenuAction[] = contextMenu ? [
    ...(lockedRoot ? [] : [{
      label: "重命名",
      onSelect: async () => {
        const next = window.prompt(`重命名${contextMenu.target.depth === 0 ? "主题" : "分组"}`, contextMenu.target.name);
        if (next?.trim()) await renameTopic(userId, contextMenu.target.id, next.trim());
      },
    }]),
    ...(contextMenu.target.depth === 0 ? [{ label: "新建分组", onSelect: () => setAddingGroup(true) }] : []),
    ...(lockedRoot ? [] : [{
      label: "删除",
      destructive: true,
      separatorBefore: true,
      onSelect: async () => {
        const isTopic = contextMenu.target.depth === 0;
        const message = isTopic
          ? `删除主题「${contextMenu.target.name}」？主题下笔记会保留；可从回收站恢复主题。`
          : `删除分组「${contextMenu.target.name}」？其中笔记不会被删除。`;
        if (!window.confirm(message)) return;
        await softDeleteTopic(userId, contextMenu.target.id);
        const currentSectionRemoved = selected.kind === "topic" && (
          selected.id === contextMenu.target.id || (isTopic && groups.some((group) => group.id === selected.id))
        );
        if (currentSectionRemoved) {
          onSelect(isTopic ? { kind: "recent" } : { kind: "topic", id: topic.id });
        }
      },
    }]),
  ] : [];

  const submitGroup = async () => {
    const clean = name.trim();
    if (!clean) { setAddingGroup(false); return; }
    await createTopic(userId, clean, topic.id);
    setName("");
    setAddingGroup(false);
  };

  return (
    <li>
      <div
        className={isSelected ? `mn-treerow on${fixed ? " priv" : ""}` : `mn-treerow${fixed ? " priv" : ""}`}
        onContextMenu={(event) => openPointerMenu(event, topic)}
        onKeyDown={(event) => openKeyboardMenu(event, topic)}
      >
        <button type="button" className="mn-tree-label" aria-haspopup="menu" onClick={() => onSelect({ kind: "topic", id: topic.id })}>
          {fixed && <Lock />}{topic.name}
        </button>
        {fixed && onLock && (
          <button type="button" className="mn-minibtn" aria-label="锁定私人空间" title="锁定" onClick={onLock}><Lock /></button>
        )}
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
              aria-haspopup="menu"
              onClick={() => onSelect({ kind: "topic", id: group.id })}
              onContextMenu={(event) => openPointerMenu(event, group)}
              onKeyDown={(event) => openKeyboardMenu(event, group)}
            >
              {group.name}
            </button>
          </li>
        ))}
      </ul>
      {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} label={`${contextMenu.target.name}菜单`} actions={actions} onClose={closeContextMenu} returnFocus={contextMenu.trigger} />}
    </li>
  );
}
