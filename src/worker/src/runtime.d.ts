// Contracts implemented by the Docker SQLite, attachment directory and background task adapters.
interface SqlResult<T> {
  success: boolean;
  results: T[];
  meta: { changes: number };
}
interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
  run<T = Record<string, unknown>>(): Promise<SqlResult<T>>;
}
interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  batch<T = Record<string, unknown>>(statements: SqlStatement[]): Promise<SqlResult<T>[]>;
}
interface AttachmentBucket {
  head(key: string): Promise<{ key: string; size: number } | null>;
  get(key: string): Promise<{ size: number; body: ReadableStream<Uint8Array>; arrayBuffer(): Promise<ArrayBuffer> } | null>;
  put(key: string, value: string | ArrayBuffer | Uint8Array): Promise<void>;
  delete(keys: string | string[]): Promise<void>;
  list(options: { prefix: string }): Promise<{ objects: Array<{ key: string; size: number }> }>;
}
interface AiProvider { run(model: string, input: Record<string, unknown>): Promise<unknown> }
interface AiQueue { send(body: unknown): Promise<void> }
interface AiMessageBatch { messages: Array<{ body: unknown; attempts: number; ack(): void; retry(): void }> }
type TaskContext = import("hono").ExecutionContext;
interface Env {
  DB: SqlDatabase;
  BUCKET: AttachmentBucket;
  AUTH_PEPPER: string;
  AI?: AiProvider;
  AI_TASKS_QUEUE?: AiQueue;
}
