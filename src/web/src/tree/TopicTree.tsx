import { ChevronDown, ChevronRight, Lock } from "lucide-react";
import type { DemoTopic } from "../lib/demoData";

interface TopicTreeProps {
  topics: DemoTopic[];
  selectedTopicId: string;
  onSelectTopic: (topicId: string) => void;
}

/* 主题树（演示）：父子层级按 parentId 渲染；私人空间仅展示锁定标识，不提供解锁。 */
export function TopicTree({ topics, selectedTopicId, onSelectTopic }: TopicTreeProps) {
  return (
    <div className="mn-tree">
      {topics.map((topic) => {
        const isChild = topic.depth === 1;
        const selected = selectedTopicId === topic.id;
        return (
          <a
            key={topic.id}
            href="#"
            className={`mn-treerow${isChild ? " l2" : ""}${selected ? " on" : ""}${topic.locked ? " priv" : ""}`}
            onClick={(event) => {
              event.preventDefault();
              if (topic.locked) return;
              onSelectTopic(topic.id);
            }}
            aria-current={selected ? "true" : undefined}
            title={topic.locked ? "私人空间将在 M2 提供解锁" : undefined}
          >
            {topic.locked ? <Lock /> : isChild ? null : topic.expanded ? <ChevronDown /> : <ChevronRight />}
            <span>{topic.name}</span>
            {topic.lockedLabel && <span className="mn-locklabel">{topic.lockedLabel}</span>}
          </a>
        );
      })}
    </div>
  );
}
