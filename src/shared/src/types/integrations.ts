/** Ciphertext placeholder only. Key derivation and envelope format require M2 review. */
export interface OpaqueCiphertext { ciphertext: string }

export interface McpToken {
  id: string;
  userId: string;
  name: string;
  tokenPrefix: string;
  tokenHash: string;
  permissions: McpPermission[];
  scope: McpTokenScope;
  includeMemos: boolean;
  allowUrl: boolean;
  ratePerMinute: number;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
  lastUsedAt: number | null;
  tokenEnc: OpaqueCiphertext;
}

export const MCP_PERMISSION_KEYS = [
  "content:read", "item:create", "item:edit", "trash:move", "attachment:access", "clip:templates:read", "clip:templates:write", "bookmark:write",
] as const;
export type McpPermission = (typeof MCP_PERMISSION_KEYS)[number];

export interface McpTokenScope {
  mode: "all" | "selected";
  topicIds: string[];
  groupIds: string[];
}

/** Safe token fields returned by management APIs. Never contains a hash or ciphertext. */
export type McpTokenView = Omit<McpToken, "tokenHash" | "tokenEnc">;

export interface McpTokenConfig {
  permissions: McpPermission[];
  scope: McpTokenScope;
  includeMemos: boolean;
  allowUrl: boolean;
  ratePerMinute: number;
  expiresAt: number | null;
}

export interface McpAudit {
  id: string;
  userId: string;
  tokenId: string;
  tool: string;
  itemId: string | null;
  revBefore: number | null;
  revAfter: number | null;
  result: string;
  operationId: string | null;
  at: number;
}

/** Versioned browser clip payload shared by Menote and Menote-clients. */
export interface McpClipRequest {
  schemaVersion: 1;
  operationId: string;
  title: string;
  markdown: string;
  sourceUrl: string;
  capturedAt: string;
  attachmentHashes?: string[];
  metadata: {
    author?: string;
    publishedAt?: string;
    siteName?: string;
    description?: string;
    canonicalUrl?: string;
  };
}

export interface McpClipResult {
  itemId: string;
  rev: number;
  result: "applied" | "duplicate";
}

/** Raindrop-compatible URL bookmark written to one explicitly selected plain Note/Table. */
export interface McpBookmarkRequest {
  schemaVersion: 1;
  operationId: string;
  targetItemId: string;
  title: string;
  link: string;
  excerpt?: string;
  note?: string;
  tags: string[];
  type: "link" | "article" | "image" | "video" | "document" | "audio";
  cover?: string;
  capturedAt: string;
  important: boolean;
}

export interface McpBookmarkResult {
  targetItemId: string;
  rev: number;
  result: "applied" | "duplicate";
}

/** 浏览器划选等来源提交的 Memo 载荷；服务端组装引用块与来源行，Memo 固定落时间线。 */
export interface McpMemoRequest {
  schemaVersion: 1;
  operationId: string;
  text: string;
  sourceUrl?: string;
  sourceTitle?: string;
  /** Structured Memo labels, stored on Item.tags. */
  tags?: string[];
}

export interface McpMemoResult {
  itemId: string;
  rev: number;
  result: "applied" | "duplicate";
}

export interface BackupTarget {
  id: string;
  userId: string;
  name: string | null;
  enabled: boolean;
  kind: "webdav" | "s3";
  endpoint: string;
  /** Remote namespace for Menote backups; defaults to `menote`. */
  remotePath: string;
  /** Maximum completed snapshots to retain; 0 means unlimited. */
  retentionCount: number;
  lastPushedAt: number | null;
  bucket: string | null;
  username: string | null;
  secretEnc: OpaqueCiphertext;
  deletePolicy: string;
  schedule: string;
  cursorSeq: number | null;
  lastResult: string | null;
}
