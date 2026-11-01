/** Ciphertext placeholder only. Key derivation and envelope format require M2 review. */
export interface OpaqueCiphertext { ciphertext: string }

export interface McpToken {
  id: string;
  userId: string;
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
  "content:read", "item:create", "item:edit", "trash:move", "attachment:access",
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
