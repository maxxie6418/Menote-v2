import { useState, type ReactNode } from "react";

export interface TemplateOption {
  id: string;
  name: string;
  /** 悬停说明（块小，说明放 title 而不是占一行）。 */
  hint: string;
  icon: ReactNode;
}

interface TemplatePickerProps {
  templates: TemplateOption[];
  onPick: (id: string) => void;
  onDropFiles?: (files: File[]) => void;
}

/**
 * 新文档模板选择（正文区正中的小方块，FR-TBL-9 入口）：
 * 点一下即生效并收起；不点、直接在下面写正文也收起（父级按「已开始写」隐藏）。
 * 每块按「一排五个」的宽度排（占版心 20%），将来加模板按同一排宽续排，超过五个自动换行。
 */
export function TemplatePicker({ templates, onPick, onDropFiles }: TemplatePickerProps) {
  const [dragging, setDragging] = useState(false);
  return (
    <div className="mn-templatepick-wrap" role="group" aria-label="选择文档模板">
      <div className="mn-templatepick">
        {templates.map((template) => (
          <button
            key={template.id}
            type="button"
            className="mn-template"
            title={template.hint}
            onClick={() => onPick(template.id)}
            onDragOver={template.id === "import" ? (event) => { event.preventDefault(); setDragging(true); } : undefined}
            onDragLeave={template.id === "import" ? () => setDragging(false) : undefined}
            onDrop={template.id === "import" ? (event) => {
              event.preventDefault();
              setDragging(false);
              onDropFiles?.(Array.from(event.dataTransfer.files));
            } : undefined}
            data-dragging={template.id === "import" && dragging || undefined}
            aria-label={template.id === "import" ? "拖入 Markdown 文档导入" : template.name}
          >
            <span className="mn-template-icon" aria-hidden="true">{template.icon}</span>
            <span className="mn-template-name">{template.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
