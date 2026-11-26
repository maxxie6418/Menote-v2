export const MEMORY_FIELDS = {
  scope: { name: "范围", type: "select", options: ["personal", "project"] },
  project_id: { name: "项目标识", type: "text" },
  key: { name: "记忆键", type: "text" },
  title: { name: "记忆项", type: "text" },
  value: { name: "当前内容", type: "text" },
  source: { name: "依据", type: "text" },
  status: { name: "状态", type: "select", options: ["active", "archived"] },
  id: { name: "行 ID", type: "text" },
  row_rev: { name: "行版本", type: "number" },
  updated_at: { name: "更新时间", type: "text" },
  updated_by: { name: "更新者", type: "text" },
} as const;

export const MEMORY_SCOPES = ["personal", "project"] as const;
export const MEMORY_STATUSES = ["active", "archived"] as const;
export const MEMORY_PROJECT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MEMORY_KEY_PATTERN = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;
export const MEMORY_LIMITS = { project: 128, key: 200, title: 500, value: 16_000, source: 4_000, page: 50 } as const;
export const MEMORY_SCHEMA_KEY = "menote_memory";
export const MEMORY_SYSTEM_COLUMNS = [MEMORY_FIELDS.id.name, MEMORY_FIELDS.row_rev.name, MEMORY_FIELDS.updated_at.name, MEMORY_FIELDS.updated_by.name] as readonly string[];

export function isMemoryMarkdown(markdown: string): boolean {
  const yaml = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown)?.[1];
  return yaml?.split(/\r?\n/).some((line) => line.trimEnd() === `${MEMORY_SCHEMA_KEY}: 1`) ?? false;
}

export type MemoryScope = typeof MEMORY_SCOPES[number];
export type MemoryStatus = typeof MEMORY_STATUSES[number];

export interface MemoryRow {
  scope: MemoryScope;
  project_id: string;
  key: string;
  title: string;
  value: string;
  source: string;
  status: MemoryStatus;
  id: string;
  row_rev: number;
  updated_at: string;
  updated_by: string;
}

export interface MemoryQuery {
  binding_id?: string;
  scope: MemoryScope;
  project_id?: string;
  key?: string;
  query?: string;
  status?: MemoryStatus | "all";
  limit?: number;
  cursor?: string;
}

export interface MemoryQueryResult {
  binding_id: string;
  rows: MemoryRow[];
  next_cursor: string | null;
}

export interface MemoryCreate extends Pick<MemoryRow, "scope" | "key" | "title" | "value" | "source"> {
  binding_id: string;
  operation_id: string;
  project_id?: string;
}

export type MemoryPatch = Partial<Pick<MemoryRow, "title" | "value" | "source" | "status">>;

export interface MemoryUpdate {
  binding_id: string;
  operation_id: string;
  id: string;
  expected_row_rev: number;
  patch: MemoryPatch;
}

export type MemoryWriteResult = Pick<MemoryRow, "id" | "row_rev" | "status">;

export interface MemoryPluginStatus {
  enabled: boolean;
  binding: { id: string; tableId: string; title: string; topicName: string | null; available: boolean; problem?: string } | null;
}

export interface MemoryBindPreview {
  tableId: string;
  rev: number;
  rowCount: number;
  columnsToAdd: string[];
  issues: { row: number | null; code: string; field?: string }[];
}
