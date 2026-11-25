import type { Item } from "@menote/shared";
import { noteTagKey } from "../../lib/noteProperties";

export function NoteTags({ item, onChange }: {
  item: Pick<Item, "type" | "tags">;
  onChange: (update: (tags: string[]) => string[]) => Promise<boolean>;
}) {
  const matches = (tag: string, other: string) => item.type === "note" ? noteTagKey(tag) === noteTagKey(other) : tag === other;
  return (
    <div className="mn-doc-tags" role="group" aria-label="标签">
      {item.tags.map((tag) => (
        <button key={tag} type="button" className="mn-tagchip" title="移除标签" aria-label={`移除标签 ${tag}`}
          onClick={() => void onChange((tags) => tags.filter((row) => !matches(row, tag)))}>
          #{tag}×
        </button>
      ))}
      <input className="mn-taginput" placeholder="加标签" title="输入标签后按回车确认" aria-label="添加标签"
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          const input = event.currentTarget;
          const read = () => input.value.trim().replace(/^#/, "");
          const tag = read();
          if (!tag) return;
          void onChange((tags) => tags.some((other) => matches(other, tag)) ? tags : [...tags, tag]).then((saved) => {
            if (saved && read() === tag) input.value = "";
          });
        }} />
    </div>
  );
}
