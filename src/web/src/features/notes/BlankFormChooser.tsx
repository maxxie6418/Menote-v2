import { FileText, Table2 } from "lucide-react";

interface BlankFormChooserProps {
  onPickTable: () => void;
}

/** 空白草稿形态选择条（FR-TBL-9）：创建后未填写内容时可选择「多维表格」；
 *  内容落下后父级不再渲染本条（锁定，守卫同时落在 setItemForm）。非打断式：可直接在下方编辑器写作。 */
export function BlankFormChooser({ onPickTable }: BlankFormChooserProps) {
  return (
    <div className="mn-formchooser" role="group" aria-label="选择文档形态">
      <span className="mn-formchooser-icon plain" aria-hidden="true"><FileText size={14} /></span>
      <span className="mn-formchooser-label">普通笔记</span>
      <button type="button" className="mn-formchooser-switch" onClick={onPickTable}>
        <Table2 size={14} aria-hidden="true" /> 转为多维表格
      </button>
      <span className="mn-formchooser-hint">内容落下后不可再切换</span>
    </div>
  );
}
