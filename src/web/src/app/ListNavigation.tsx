import { Tag } from "lucide-react";
import { useAllTags, type BrowseSection } from "../services/contentHooks";
import { TopicTree } from "../features/tree";

interface ListNavigationProps {
  userId: string;
  selected: BrowseSection;
  onSelect: (section: BrowseSection) => void;
  onOpenPrivate: () => void;
  onDropItem: (itemId: string, topicId: string, groupId: string | null) => void | Promise<unknown>;
}

/** 书脊布局下沉到笔记清单的主题树与标签导航。 */
export function ListNavigation(props: ListNavigationProps) {
  const tags = useAllTags(props.userId);
  return (
    <nav className="mn-list-navigation" aria-label="主题与标签">
      <TopicTree {...props} />
      <div className="mn-list-navigation-tags">
        <div className="mn-list-navigation-label"><Tag aria-hidden="true" />标签</div>
        {tags.length === 0 ? <p>暂无标签</p> : tags.map((tag) => (
          <button key={tag} type="button" className={props.selected.kind === "tag" && props.selected.tag === tag ? "on" : ""}
            onClick={() => props.onSelect({ kind: "tag", tag })}>#{tag}</button>
        ))}
      </div>
    </nav>
  );
}
