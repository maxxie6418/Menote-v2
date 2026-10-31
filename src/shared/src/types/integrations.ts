/** Ciphertext placeholder only. Key derivation and envelope format require M2 review. */
export interface OpaqueCiphertext { ciphertext: string }

export interface McpToken {
  id: string;
  userId: string;
  tokenPrefix: string;
  permissions: string[];
  scope: unknown;
  includeMemos: boolean;
  allowUrl: boolean;
  ratePerMinute: number;
  expiresAt: number | null;
  revokedAt: number | null;
  tokenEnc: OpaqueCiphertext;
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
  kind: "webdav" | "s3";
  endpoint: string;
  bucket: string | null;
  username: string | null;
  secretEnc: OpaqueCiphertext;
  deletePolicy: string;
  schedule: string;
  cursorSeq: number | null;
  lastResult: string | null;
}
