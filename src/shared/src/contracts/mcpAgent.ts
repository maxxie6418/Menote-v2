import type { Item } from "../types/item";

export type McpItemSummary =
  | { id: string; title: string | null; encrypted: true }
  | { id: string; title: string | null; encrypted: false; type: Item["type"]; tags: string[];
    status: Item["status"]; folder_id: string | null; rev: number; meta_rev: number; updated_at: number };

export interface McpItemQuery {
  query?: string;
  type?: Item["type"];
  folder_id?: string | null;
  tag?: string;
  task_status?: NonNullable<Item["status"]>;
  updated_after?: number;
  cursor?: string;
  limit?: number;
}

export interface McpCreateItemRequest {
  type: "note" | "memo" | "table";
  title?: string;
  content: string;
  tags?: string[];
  task?: { status?: NonNullable<Item["status"]> };
  operation_id: string;
}
