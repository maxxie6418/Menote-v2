import { Type, Hash, Calendar, Clock, Tag, Tags, CheckSquare, Link, Paperclip, List } from "../../icons";
import { TABLE_FIELD_TYPES, type PropertyType } from "../../lib/frontmatter";

/** 字段类型中文标签（表格侧 9 种，无多行文本）。 */
export const FIELD_TYPE_LABELS: Readonly<Record<PropertyType, string>> = {
  text: "文本", multiline: "多行文本", number: "数字", date: "日期", datetime: "日期时间", list: "列表",
  select: "单选", multiselect: "多选", checkbox: "复选框", link: "链接",
  attachment: "附件",
};

const FIELD_ICONS = { text: Type, multiline: Type, number: Hash, date: Calendar, datetime: Clock, list: List, select: Tag, multiselect: Tags, checkbox: CheckSquare, link: Link, attachment: Paperclip };

interface FieldTypeMenuProps {
  value?: PropertyType;
  onPick: (type: PropertyType) => void;
}

/** 字段类型菜单（9 种）：加列与改列类型共用。 */
export function FieldTypeMenu({ value, onPick }: FieldTypeMenuProps) {
  return (
    <div className="mn-ftmenu" role="menu" aria-label="字段类型">
      {TABLE_FIELD_TYPES.map((type) => {
        const Icon = FIELD_ICONS[type];
        return (
          <button key={type} type="button" role="menuitem" aria-pressed={type === value}
            className={type === value ? "mn-ftmenu-item on" : "mn-ftmenu-item"}
            onClick={() => onPick(type)}>
            <Icon aria-hidden="true" />{FIELD_TYPE_LABELS[type]}
          </button>
        );
      })}
    </div>
  );
}
