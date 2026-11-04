import { useEffect, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ChevronDown, GripVertical, Lock, Plus } from "lucide-react";
import { useLockVersion, useTopics, type BrowseSection } from "../../services/contentHooks";
import { createTopic, moveGroupToTopic, renameTopic, softDeleteTopic } from "../../services/contentService";
import { isTopicUnlocked } from "../../services/keyringService";
import { lockPrivateSpace } from "../../services/privateSpaceService";
import { ContextMenu, type ContextMenuAction } from "../../components/ui/ContextMenu";
import { SectionHead } from "../../components/ui/SectionHead";
import { DEFAULT_WORKSPACE_SETTINGS, orderIds, readWorkspaceSettings, updateWorkspaceSettings, type WorkspaceSettings } from "../../services/workspaceSettingsService";

interface TopicTreeProps {
  userId: string;
  selected: BrowseSection;
  onSelect: (section: BrowseSection) => void;
  onOpenPrivate: () => void;
  onDropItem: (itemId: string, topicId: string, groupId: string | null) => void | Promise<unknown>;
}

/** 主题树（FR-IA-1/3：主题与分组，分组最多一层）。
    2026-11-03 定稿：加密空间是「空间」不是「分类」，独立成行放在主题段之上；
    「新建主题」收进段标题行，内联输入贴在标题正下方，列表底部不再常驻创建入口。 */
export function TopicTree({ userId, selected, onSelect, onOpenPrivate, onDropItem }: TopicTreeProps) {
  useLockVersion();
  const topics = useTopics(userId);
  const active = topics.filter((row) => row.deletedAt === null);
  const space = active.find((row) => row.depth === 0 && row.isEncSpace);
  const spaceOpen = space ? isTopicUnlocked(space.id) : false;
  const roots = active.filter((row) => row.depth === 0 && !row.isEncSpace);
  const [workspace, setWorkspace] = useState<WorkspaceSettings>(DEFAULT_WORKSPACE_SETTINGS);
  const [treeDragId, setTreeDragId] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => { void readWorkspaceSettings(userId).then(setWorkspace); };
    refresh();
    window.addEventListener("menote:workspace-settings", refresh);
    return () => window.removeEventListener("menote:workspace-settings", refresh);
  }, [userId]);
  const orderedRoots = orderIds(roots.map((row) => row.id), workspace.topicOrder)
    .map((id) => roots.find((row) => row.id === id)!).filter(Boolean);
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
    <>
      {space && spaceOpen ? (
        <ul className="mn-tree-list mn-tree-space" aria-label="加密空间">
          <TopicNodeView
            userId={userId} topic={space} fixed
            groups={active.filter((row) => row.depth === 1 && row.parentId === space.id)}
            selected={selected} onSelect={onSelect}
            onDropItem={onDropItem}
            onLock={() => { void lockPrivateSpace(userId); onSelect({ kind: "recent" }); }}
          />
        </ul>
      ) : (
        <button type="button" className="mn-space" onClick={onOpenPrivate} aria-label={`加密空间，${space ? "已锁定" : "未设置"}`}>
          <Lock aria-hidden="true" />
          <span>加密空间</span>
          <span className="mn-space-state">{space ? "已锁" : "未设置"}</span>
        </button>
      )}

      <SectionHead
        label="主题"
        count={roots.length}
        action={{
          label: "新建主题",
          icon: <Plus aria-hidden="true" />,
          onClick: () => setCreating(true),
        }}
      />
      {creating && (
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
      )}
      <div className="mn-tree">
        <ul className="mn-tree-list">
          {orderedRoots.map((topic) => (
            <TopicNodeView
              key={topic.id} userId={userId} topic={topic}
              groups={orderIds(active.filter((row) => row.depth === 1 && row.parentId === topic.id).map((row) => row.id), workspace.groupOrder[topic.id] ?? [])
                .map((id) => active.find((row) => row.id === id)!).filter(Boolean)}
              selected={selected} onSelect={onSelect} onDropItem={onDropItem}
              draggingId={treeDragId} onDragStart={(id) => { setTreeDragId(id); }} onDragEnd={() => setTreeDragId(null)}
              onTreeDrop={async (sourceId, targetId, after = false) => {
                const source = active.find((row) => row.id === sourceId);
                const target = active.find((row) => row.id === targetId);
                if (!source || !target || sourceId === targetId || source.isEncSpace || target.isEncSpace) return;
                if (source.depth === 0 && target.depth === 0) {
                  const ids = orderedRoots.map((row) => row.id).filter((id) => id !== sourceId);
                  const index = ids.indexOf(targetId);
                  ids.splice(index < 0 ? ids.length : index + (after ? 1 : 0), 0, sourceId);
                  const next = { ...workspace, topicOrder: ids };
                  setWorkspace(next); await updateWorkspaceSettings(userId, { topicOrder: ids });
                  return;
                }
                if (source.depth !== 1) return;
                const newParentId = target.depth === 0 ? target.id : target.parentId;
                if (!newParentId) return;
                if (source.parentId !== newParentId) await moveGroupToTopic(userId, sourceId, newParentId);
                const siblings = active.filter((row) => row.depth === 1 && row.parentId === newParentId).map((row) => row.id).filter((id) => id !== sourceId);
                const targetIndex = target.depth === 1 && target.parentId === newParentId ? siblings.indexOf(targetId) : siblings.length;
                siblings.splice(targetIndex < 0 ? siblings.length : targetIndex + (after ? 1 : 0), 0, sourceId);
                const nextOrder = { ...workspace.groupOrder, [newParentId]: siblings };
                setWorkspace({ ...workspace, groupOrder: nextOrder });
                await updateWorkspaceSettings(userId, { groupOrder: nextOrder });
              }}
            />
          ))}
          {roots.length === 0 && !creating && <li className="mn-tree-empty">暂无主题</li>}
        </ul>
      </div>
    </>
  );
}

interface TopicNodeViewProps {
  userId: string;
  topic: { id: string; name: string; depth: 0 | 1 };
  groups: Array<{ id: string; name: string; depth: 0 | 1 }>;
  selected: BrowseSection;
  onSelect: (section: BrowseSection) => void;
  onDropItem: (itemId: string, topicId: string, groupId: string | null) => void | Promise<unknown>;
  draggingId?: string | null;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
  onTreeDrop?: (sourceId: string, targetId: string, after?: boolean) => void | Promise<void>;
  fixed?: boolean;
  onLock?: () => void;
}

function TopicNodeView({ userId, topic, groups, selected, onSelect, onDropItem, fixed = false, onLock, draggingId, onDragStart, onDragEnd, onTreeDrop }: TopicNodeViewProps) {
  const [addingGroup, setAddingGroup] = useState(false);
  const [open, setOpen] = useState(true);
  const [name, setName] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: { id: string; name: string; depth: 0 | 1 }; trigger: HTMLElement } | null>(null);
  const isSelected = selected.kind === "topic" && selected.id === topic.id;
  const hasGroups = groups.length > 0;

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
        className={`${isSelected ? `mn-treerow on${fixed ? " priv" : ""}` : `mn-treerow${fixed ? " priv" : ""}`} ${draggingId === topic.id ? "dragging" : ""}`}
        onDragOver={(event) => {
          const itemDrag = event.dataTransfer.types.includes("application/x-menote-item");
          const privateItem = event.dataTransfer.types.includes("application/x-menote-private-item");
          const treeDrag = event.dataTransfer.types.includes("application/x-menote-topic");
          if ((itemDrag && (fixed === privateItem)) || (!fixed && treeDrag)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }
        }}
        onDrop={(event) => {
          const itemId = event.dataTransfer.getData("application/x-menote-item");
          const privateItem = event.dataTransfer.types.includes("application/x-menote-private-item");
          if (itemId && fixed === privateItem) { event.preventDefault(); event.stopPropagation(); void onDropItem(itemId, topic.id, null); return; }
          const sourceId = event.dataTransfer.getData("application/x-menote-topic");
          if (sourceId && !fixed) {
            event.preventDefault(); event.stopPropagation();
            const bounds = event.currentTarget.getBoundingClientRect();
            void onTreeDrop?.(sourceId, topic.id, event.clientY >= bounds.top + bounds.height / 2);
          }
        }}
        onContextMenu={(event) => openPointerMenu(event, topic)}
        onKeyDown={(event) => openKeyboardMenu(event, topic)}
      >
        {hasGroups ? (
          <button
            type="button" className="mn-tree-chevbtn" aria-expanded={open}
            aria-label={open ? `收起「${topic.name}」` : `展开「${topic.name}」`}
            onClick={() => setOpen((value) => !value)}
          >
            <ChevronDown className="mn-tree-chev" data-open={open} aria-hidden="true" />
          </button>
        ) : (
          <span className="mn-tree-slot" aria-hidden="true" />
        )}
        <button type="button" className="mn-tree-label" aria-haspopup="menu" onClick={() => onSelect({ kind: "topic", id: topic.id })}>
          {fixed && <Lock />}{topic.name}
        </button>
        {!fixed && <button type="button" className="mn-tree-drag" draggable aria-label={`拖动「${topic.name}」调整目录位置`} title="拖动调整位置"
          onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-menote-topic", topic.id); onDragStart?.(topic.id); }} onDragEnd={onDragEnd}><GripVertical aria-hidden="true" /></button>}
        {fixed && onLock && (
          <button type="button" className="mn-minibtn" aria-label="锁定加密空间" title="锁定" onClick={onLock}><Lock /></button>
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
      {hasGroups && open && (
        <ul className="mn-tree-sublist">
          {groups.map((group) => (
            <li key={group.id}>
              <button
                type="button"
                className={`${selected.kind === "topic" && selected.id === group.id ? "mn-treerow on" : "mn-treerow"} ${draggingId === group.id ? "dragging" : ""}`}
                aria-haspopup="menu"
                draggable={!fixed}
                onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-menote-topic", group.id); onDragStart?.(group.id); }}
                onDragEnd={onDragEnd}
                onDragOver={(event) => {
                  const itemDrag = event.dataTransfer.types.includes("application/x-menote-item");
                  const privateItem = event.dataTransfer.types.includes("application/x-menote-private-item");
                  const treeDrag = event.dataTransfer.types.includes("application/x-menote-topic");
                  if ((itemDrag && (fixed === privateItem)) || (!fixed && treeDrag)) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }
                }}
                onDrop={(event) => {
                  const itemId = event.dataTransfer.getData("application/x-menote-item");
                  const privateItem = event.dataTransfer.types.includes("application/x-menote-private-item");
                  if (itemId && fixed === privateItem) { event.preventDefault(); event.stopPropagation(); void onDropItem(itemId, topic.id, group.id); return; }
                  const sourceId = event.dataTransfer.getData("application/x-menote-topic");
                  if (sourceId && !fixed) {
                    event.preventDefault(); event.stopPropagation();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    void onTreeDrop?.(sourceId, group.id, event.clientY >= bounds.top + bounds.height / 2);
                  }
                }}
                onClick={() => onSelect({ kind: "topic", id: group.id })}
                onContextMenu={(event) => openPointerMenu(event, group)}
                onKeyDown={(event) => openKeyboardMenu(event, group)}
              >
                {group.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {contextMenu && <ContextMenu x={contextMenu.x} y={contextMenu.y} label={`${contextMenu.target.name}菜单`} actions={actions} onClose={closeContextMenu} returnFocus={contextMenu.trigger} />}
    </li>
  );
}
