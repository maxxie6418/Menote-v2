import { useMemo, useState } from "react";
import {
  type ParsedTable, findTables, replaceTable, extractTableDoc,
} from "../../lib/gfmTable";
import { FIELDS_KEY, type PropertyType, readDefs, TABLE_FIELD_TYPES } from "../../lib/frontmatter";
import { TableCellEditor } from "./TableCellEditor";

interface TableBlockDialogProps {
  markdown: string;
  /** 写回经统一链路：上层保存新 markdown。 */
  onSave: (next: string) => void;
  onClose: () => void;
  /** 抽出为独立表格文档（FR-TBL-3）。 */
  onExtract: (content: string) => void;
}

type CellGrid = string[][];

/** 表格结构化编辑（FR-TBL-2/5/7）：任何 GFM 表格可进入网格编辑；无定义字段按文本；
 *  载体永远是标准 GFM（FR-TBL-1）；写回契约见 lib/gfmTable（FR-TBL-6）。 */
export function TableBlockDialog({ markdown, onSave, onClose, onExtract }: TableBlockDialogProps) {
  const { body, frontText } = useMemo(() => {
    const index = markdown.indexOf("\n---", 3);
    const hasFront = markdown.startsWith("---") && index !== -1;
    return { body: hasFront ? markdown.slice(index + 4) : markdown, frontText: hasFront ? markdown.slice(0, index + 4) : "" };
  }, [markdown]);
  const tables = useMemo(() => findTables(body), [body]);
  const [tableIndex, setTableIndex] = useState(0);
  const table: ParsedTable | undefined = tables[tableIndex];
  const fieldDefs = useMemo(() => readDefs(markdown, FIELDS_KEY), [markdown]);
  const [grid, setGrid] = useState<CellGrid | null>(null);

  if (tables.length === 0) {
    return (
      <div className="mn-overlay" role="presentation">
        <div className="mn-dialog" role="dialog" aria-modal="true" aria-label="表格结构化编辑">
          <div className="mn-dialog-head"><p className="mn-dialog-title">表格结构化编辑</p></div>
          <div className="mn-dialog-body">
            <p className="mn-auth-hint">本文档没有可解析的 GFM 表格。表格需要表头行、`---` 分隔行与行首管道符。</p>
          </div>
          <div className="mn-dialog-actions">
            <button type="button" className="mn-auth-link" onClick={onClose}>关闭</button>
          </div>
        </div>
      </div>
    );
  }

  const current: CellGrid = grid ?? [table!.header, ...table!.rows];
  const columnType = (column: number): PropertyType => {
    const name = table!.header[column]?.trim() ?? "";
    const def = fieldDefs[name];
    return def && TABLE_FIELD_TYPES.includes(def.type) ? def.type : "text";
  };

  const setCell = (row: number, column: number, value: string) => {
    setGrid(() => current.map((cells, r) => r === row ? cells.map((cell, c) => (c === column ? value : cell)) : cells));
  };

  const apply = () => {
    const [header, ...rows] = current;
    const next: ParsedTable = { ...table!, header, rows };
    onSave(`${frontText}${replaceTable(body, tableIndex, next)}`);
    setGrid(null);
  };

  const addRow = () => setGrid(() => [...current, current[0]!.map(() => "")]);
  const removeRow = (row: number) => setGrid(() => current.filter((_, index) => index !== row));

  return (
    <div className="mn-overlay" role="presentation">
      <div className="mn-dialog mn-dialog-wide" role="dialog" aria-modal="true" aria-label="表格结构化编辑">
        <div className="mn-dialog-head"><p className="mn-dialog-title">表格结构化编辑（{tables.length > 1 ? `第 ${tableIndex + 1} 个，` : ""}字段类型来自 YAML `fields:`）</p></div>
        <div className="mn-dialog-body">
          {tables.length > 1 && (
            <select className="mn-propselect" value={tableIndex} aria-label="选择表格"
              onChange={(event) => { setTableIndex(Number(event.target.value)); setGrid(null); }}>
              {tables.map((_, index) => <option key={index} value={index}>表格 {index + 1}</option>)}
            </select>
          )}
          <div className="mn-tablegrid" role="grid">
            {current.map((cells, rowIndex) => (
              <div key={rowIndex} className={rowIndex === 0 ? "mn-tablegrid-row head" : "mn-tablegrid-row"} role="row">
                {cells.map((cell, columnIndex) => (
                  <div key={columnIndex} role="gridcell">
                    {rowIndex === 0 ? (
                      <input
                        className="mn-tablegrid-input" type="text"
                        value={cell} aria-label="表头单元格"
                        onChange={(event) => setCell(rowIndex, columnIndex, event.target.value)}
                      />
                    ) : (
                      <TableCellEditor
                        value={cell} type={columnType(columnIndex)}
                        def={fieldDefs[table!.header[columnIndex]?.trim() ?? ""]}
                        onChange={(value) => setCell(rowIndex, columnIndex, value)}
                      />
                    )}
                  </div>
                ))}
                {rowIndex > 0 && (
                  <button type="button" className="mn-minibtn" aria-label="删除此行" onClick={() => removeRow(rowIndex)}>×</button>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="mn-dialog-actions">
          <button type="button" className="mn-auth-submit" onClick={apply}>写回正文</button>
          <button type="button" className="mn-auth-link" onClick={addRow}>加一行</button>
          <button type="button" className="mn-auth-link" onClick={() => {
            const [header, ...rows] = current;
            onExtract(extractTableDoc(header, rows, fieldDefs));
          }}>抽出为表格文档</button>
          <button type="button" className="mn-auth-link" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
