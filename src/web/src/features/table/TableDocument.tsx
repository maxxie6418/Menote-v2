import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  FIELDS_KEY, readDefs, removeDef, renameDef, splitFrontmatter, writeDef,
  type PropertyDef, type PropertyType,
} from "../../lib/frontmatter";
import { findTables, renderTable, replaceTable, type ParsedTable } from "../../lib/gfmTable";
import { TableCellEditor } from "./TableCellEditor";
import { FIELD_TYPE_LABELS, FieldTypeMenu } from "./FieldTypeMenu";

interface TableDocumentProps {
  /** 全文（frontmatter + 正文），受控：编辑即回调整篇。 */
  markdown: string;
  onChangeMarkdown: (next: string) => void;
  /** 正文存在但表格结构无法解析时触发（FR-VER-2 降级，封存在服务层）。 */
  onDegrade: () => void;
  /** 空白表格文档切回普通笔记（仅空白期可用，守卫在 setItemForm）。 */
  onSwitchToNote: () => void;
}

interface Grid {
  header: string[];
  rows: string[][];
}

const joinDoc = (frontText: string | null, body: string): string => (frontText ? `${frontText}\n\n${body}` : body);

function removeFirstTable(body: string): string {
  const table = findTables(body)[0];
  if (!table) return body;
  const lines = body.split(/\r?\n/);
  lines.splice(table.startLine, table.endLine - table.startLine + 1);
  return lines.join("\n").replace(/^[ \t]*\n+/, "").trimEnd();
}

/** 多维表格整页网格（TP2）：列管理 + 行管理 + 类型化单元格编辑；载体永远是标准 GFM（FR-TBL-1）。
 *  字段定义写 YAML `fields:`（FR-TBL-3）；与属性区共用同一套类型与序列化（FR-PROP-4）。 */
export function TableDocument({ markdown, onChangeMarkdown, onDegrade, onSwitchToNote }: TableDocumentProps) {
  const { frontText, body } = useMemo(() => splitFrontmatter(markdown), [markdown]);
  const fieldDefs = useMemo(() => readDefs(markdown, FIELDS_KEY), [markdown]);
  const table: ParsedTable | undefined = useMemo(() => findTables(body)[0], [body]);
  const blank = !/\S/.test(body);

  const [menuCol, setMenuCol] = useState<number | null>(null);
  const [addingCol, setAddingCol] = useState(false);
  const [renames, setRenames] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [draggingRow, setDraggingRow] = useState<number | null>(null);

  /* 脚手架态（正文无表格）：列由 fields: 推导；首个字段/首行写入后进入网格态。 */
  const scaffoldHeader = table ? null : Object.keys(fieldDefs);

  const applyGrid = (header: string[], rows: string[][]) => {
    if (table) {
      onChangeMarkdown(joinDoc(frontText, replaceTable(body, 0, { ...table, header, rows })));
    } else {
      const tableText = renderTable(header, rows);
      const trimmed = body.trimEnd();
      onChangeMarkdown(joinDoc(frontText, trimmed ? `${trimmed}\n\n${tableText}\n` : `${tableText}\n`));
    }
  };

  const columnType = (col: number): PropertyType => {
    const name = (table?.header[col] ?? scaffoldHeader?.[col] ?? "").trim();
    const def = fieldDefs[name];
    return def ? def.type : "text";
  };

  /* ---------- 单元格与行 ---------- */

  const setCell = (row: number, col: number, value: string) => {
    if (!table) return;
    const rows = table.rows.map((cells, r) => (r === row ? cells.map((cell, c) => (c === col ? value : cell)) : cells));
    applyGrid(table.header, rows);
  };

  const addRow = () => {
    const header = table?.header ?? scaffoldHeader ?? [];
    if (header.length === 0) return;
    const rows = table ? [...table.rows, header.map(() => "")] : [header.map(() => "")];
    applyGrid(header, rows);
  };

  const removeRow = (row: number) => {
    if (!table) return;
    applyGrid(table.header, table.rows.filter((_, index) => index !== row));
  };

  const moveRow = (from: number, to: number) => {
    if (!table || from === to || from < 0 || to < 0 || from >= table.rows.length || to >= table.rows.length) return;
    const rows = [...table.rows];
    const [moved] = rows.splice(from, 1);
    rows.splice(to, 0, moved);
    applyGrid(table.header, rows);
  };

  /* ---------- 列管理 ---------- */

  const addColumn = (name: string, type: PropertyType, options?: string[]) => {
    const clean = name.trim();
    if (!clean) { setError("字段名不能为空"); return; }
    const existing = table?.header ?? scaffoldHeader ?? [];
    if (existing.some((item) => item.trim() === clean)) { setError(`字段名「${clean}」已存在`); return; }
    const def: PropertyDef = options ? { type, options } : { type };
    if (!table && !frontText) {
      // 脚手架且无 frontmatter：writeDef 会创建；正文不变，脚手架由 fields: 重新推导。
      onChangeMarkdown(writeDef(markdown, FIELDS_KEY, clean, def));
      setAddingCol(false);
      setError(null);
      return;
    }
    let next = writeDef(markdown, FIELDS_KEY, clean, def);
    if (table) {
      const { frontText: ft, body: nextBody } = splitFrontmatter(next);
      const current = findTables(nextBody)[0];
      if (current) {
        next = joinDoc(ft, replaceTable(nextBody, 0, {
          ...current, header: [...current.header, clean], rows: current.rows.map((row) => [...row, ""]),
        }));
      }
    }
    onChangeMarkdown(next);
    setAddingCol(false);
    setError(null);
  };

  const commitRename = (col: number) => {
    if (!table) {
      // 脚手架：仅重命名 fields: 定义键
      const draft = renames[col];
      if (draft === undefined) return;
      const oldName = scaffoldHeader?.[col] ?? "";
      const rest = { ...renames };
      delete rest[col];
      setRenames(rest);
      const newName = draft.trim();
      if (!newName || newName === oldName) return;
      if ((scaffoldHeader ?? []).some((item, index) => index !== col && item.trim() === newName)) {
        setError(`字段名「${newName}」已存在`);
        return;
      }
      onChangeMarkdown(renameDef(markdown, FIELDS_KEY, oldName, newName));
      setError(null);
      return;
    }
    const draft = renames[col];
    if (draft === undefined) return;
    const rest = { ...renames };
    delete rest[col];
    setRenames(rest);
    const newName = draft.trim();
    const oldName = table.header[col]?.trim() ?? "";
    if (!newName || newName === oldName) return;
    if (table.header.some((item, index) => index !== col && item.trim() === newName)) {
      setError(`字段名「${newName}」已存在`);
      return;
    }
    const header = table.header.map((item, index) => (index === col ? newName : item));
    let next = joinDoc(frontText, replaceTable(body, 0, { ...table, header, rows: table.rows }));
    if (fieldDefs[oldName]) next = renameDef(next, FIELDS_KEY, oldName, newName);
    onChangeMarkdown(next);
    setError(null);
  };

  const changeColumnType = (col: number, type: PropertyType) => {
    const name = (table?.header[col] ?? scaffoldHeader?.[col] ?? "").trim();
    if (!name) return;
    const existing = fieldDefs[name];
    const def: PropertyDef = {
      type,
      ...(existing?.label ? { label: existing.label } : {}),
      ...(existing?.options ? { options: existing.options } : {}),
    };
    // 类型是增强信息：不迁移既有值（FR-TBL-4 精神），仅影响后续编辑控件。
    onChangeMarkdown(writeDef(markdown, FIELDS_KEY, name, def));
    setMenuCol(null);
  };

  const setColumnOptions = (col: number, raw: string) => {
    const name = (table?.header[col] ?? scaffoldHeader?.[col] ?? "").trim();
    const existing = fieldDefs[name];
    if (!existing || (existing.type !== "select" && existing.type !== "multiselect")) return;
    const options = raw.split("\n").map((item) => item.trim()).filter(Boolean);
    if (options.some((option) => option.includes(","))) {
      setError("候选值不能包含逗号（FR-TBL-6）");
      return;
    }
    setError(null);
    onChangeMarkdown(writeDef(markdown, FIELDS_KEY, name, { type: existing.type, options }));
  };

  const removeColumn = (col: number) => {
    const header = table?.header ?? scaffoldHeader ?? [];
    const name = header[col]?.trim() ?? "";
    if (header.length <= 1) {
      // 最后一列：回到脚手架（删表体 + 删定义）
      let next = frontText ? joinDoc(frontText, removeFirstTable(body)) : removeFirstTable(body);
      if (fieldDefs[name]) next = removeDef(next, FIELDS_KEY, name);
      onChangeMarkdown(next);
      setMenuCol(null);
      return;
    }
    if (table) {
      const nextHeader = table.header.filter((_, index) => index !== col);
      const rows = table.rows.map((row) => row.filter((_, index) => index !== col));
      let next = joinDoc(frontText, replaceTable(body, 0, { ...table, header: nextHeader, rows }));
      if (fieldDefs[name]) next = removeDef(next, FIELDS_KEY, name);
      onChangeMarkdown(next);
    } else if (fieldDefs[name]) {
      onChangeMarkdown(removeDef(markdown, FIELDS_KEY, name));
    }
    setMenuCol(null);
  };

  /* ---------- 渲染 ---------- */

  if (!table && !blank) {
    return (
      <div className="mn-tabledoc" aria-label="多维表格">
        <div className="mn-tabledoc-degrade" role="alert">
          <p>表格结构无法解析（需要表头行、`---` 分隔行与行首管道符）。</p>
          <button type="button" className="mn-auth-submit"
            onClick={() => { if (window.confirm("封存当前版本并降级为普通笔记？降级后不可恢复为表格。")) onDegrade(); }}>
            转为普通笔记
          </button>
        </div>
      </div>
    );
  }

  const header = table?.header ?? scaffoldHeader ?? [];

  return (
    <div className="mn-tabledoc" aria-label="多维表格">
      {error && <p className="mn-tabledoc-error" role="alert">{error}</p>}
      {header.length > 0 && (
        <>
          <div className="mn-tabledoc-bar">
            <span className="mn-tabledoc-bar-meta">{header.length} 字段 · {(table?.rows ?? []).length} 行</span>
            <div className="mn-tabledoc-bar-actions">
              <button type="button" className="mn-textbtn" aria-expanded={addingCol}
                onClick={() => { setAddingCol((open) => !open); setMenuCol(null); }}>
                <Plus aria-hidden="true" /> 添加字段
              </button>
              <button type="button" className="mn-textbtn" onClick={onSwitchToNote}>切换为普通笔记</button>
            </div>
          </div>
          {/* 加字段表单常驻在工具条下方，不再做成表头里的浮层——浮层会被表格滚动容器裁掉 */}
          {addingCol && (
            <AddColumnForm onConfirm={addColumn} onCancel={() => setAddingCol(false)}
              taken={header.map((item) => item.trim())} />
          )}
        </>
      )}
      {header.length === 0 ? (
        <div className="mn-tabledoc-scaffold">
          <p>空白表格文档：从添加第一个字段开始（字段定义存 YAML `fields:`，内容为标准 Markdown 表格）。</p>
          <div className="mn-tabledoc-scaffold-actions">
            <button type="button" className="mn-auth-submit" aria-expanded={addingCol} onClick={() => setAddingCol((open) => !open)}>
              <Plus size={14} aria-hidden="true" /> 添加字段
            </button>
            <button type="button" className="mn-auth-link" onClick={onSwitchToNote}>切换为普通笔记</button>
          </div>
          {addingCol && <AddColumnForm onConfirm={addColumn} onCancel={() => setAddingCol(false)} taken={[]} />}
        </div>
      ) : (
        <div className="mn-tabledoc-scroll">
          <div className="mn-tabledoc-grid" role="grid">
            {/* 表头行 */}
            <div className="mn-tabledoc-row head" role="row">
              <div className="mn-tabledoc-rownum" role="columnheader" aria-label="行号" />
              {header.map((name, col) => {
                const type = columnType(col);
                const def = fieldDefs[name.trim()];
                return (
                  <div className="mn-tabledoc-hcell" role="columnheader" key={col}>
                    <input
                      className="mn-tabledoc-hname" value={renames[col] ?? name} aria-label={`字段名（${name}）`}
                      onChange={(event) => setRenames((prev) => ({ ...prev, [col]: event.target.value }))}
                      onBlur={() => commitRename(col)}
                      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                    />
                    <button type="button" className="mn-tabledoc-hbadge" aria-label={`字段类型：${FIELD_TYPE_LABELS[type]}`}
                      aria-expanded={menuCol === col} onClick={() => setMenuCol(menuCol === col ? null : col)}>
                      {FIELD_TYPE_LABELS[type]}
                    </button>
                    {menuCol === col && (
                      <div className="mn-tcell-pop mn-tabledoc-hmenu">
                        <FieldTypeMenu value={def?.type} onPick={(picked) => changeColumnType(col, picked)} />
                        {def && (def.type === "select" || def.type === "multiselect") && (
                          <label className="mn-tabledoc-optedit">
                            候选值（每行一个，禁含逗号）
                            <textarea
                              rows={4} value={(def.options ?? []).join("\n")}
                              onChange={(event) => setColumnOptions(col, event.target.value)}
                            />
                          </label>
                        )}
                        <button type="button" className="mn-tabledoc-hdel"
                          onClick={() => { if (window.confirm(`删除字段「${name}」及其所有单元格内容？`)) removeColumn(col); }}>
                          删除字段
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {/* 数据行 */}
            {(table?.rows ?? []).map((cells, row) => (
              <div className={`mn-tabledoc-row${draggingRow === row ? " dragging" : ""}`} role="row" key={row}
                onDragEnd={() => setDraggingRow(null)}
                onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
                onDrop={(event) => { event.preventDefault(); if (draggingRow !== null) moveRow(draggingRow, row); setDraggingRow(null); }}>
                <div className="mn-tabledoc-rownum" role="rowheader">
                  <span className="mn-tabledoc-drag" aria-hidden="true" title="拖动调整行顺序" draggable
                    onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(row)); setDraggingRow(row); }}
                    onClick={(event) => event.stopPropagation()}>⠿</span>
                  <span>{row + 1}</span>
                  <button type="button" className="mn-tabledoc-rowdel" aria-label={`删除第 ${row + 1} 行`} onClick={() => removeRow(row)}><Trash2 aria-hidden="true" /></button>
                </div>
                {header.map((name, col) => (
                  <div className="mn-tabledoc-cell" role="gridcell" key={col}>
                    <TableCellEditor
                      value={cells[col] ?? ""} type={columnType(col)} def={fieldDefs[name.trim()]}
                      onChange={(value) => setCell(row, col, value)}
                    />
                  </div>
                ))}
              </div>
            ))}
            {/* 添加行 */}
            <div className="mn-tabledoc-row foot" role="row">
              <div className="mn-tabledoc-rownum" role="presentation" />
              {header.map((_, col) => <div className="mn-tabledoc-cell ghost" role="presentation" key={col} />)}
            </div>
          </div>
          <div className="mn-tabledoc-actions">
            <button type="button" className="mn-auth-link" onClick={addRow}>
              <Plus size={14} aria-hidden="true" /> 添加行
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 加字段表单：命名 + 选类型（ FieldTypeMenu 7 种）。 */
function AddColumnForm({ onConfirm, onCancel, taken }: {
  onConfirm: (name: string, type: PropertyType, options?: string[]) => void;
  onCancel: () => void;
  taken: string[];
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyType>("text");
  const formRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !formRef.current?.contains(event.target)) onCancel();
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onCancel]);
  return (
    <div ref={formRef} className="mn-tabledoc-addform" role="form" aria-label="添加字段" onPointerDown={(event) => event.stopPropagation()}>
      <input className="mn-tabledoc-hname" value={name} autoFocus aria-label="字段名" placeholder="字段名"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && name.trim() && !taken.includes(name.trim())) onConfirm(name, type); }} />
      <FieldTypeMenu value={type} onPick={setType} />
      <div className="mn-tabledoc-addform-actions">
        <button type="button" className="mn-auth-submit" disabled={!name.trim() || taken.includes(name.trim())}
          onClick={() => onConfirm(name, type)}>添加</button>
        <button type="button" className="mn-auth-link" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
