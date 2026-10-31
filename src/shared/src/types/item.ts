/** Opaque ciphertext is encoded for transport; encryption format is not specified in M1. */
export type StoredContent =
  | { scope: "plain"; markdown: string }
  | { scope: "self" | "private_space"; ciphertext: string };

/** Initial transport shape; synchronization and key wrapping remain M2 design work. */
interface ItemFields {
  id: string;
  userId: string;
  topicId: string | null;
  groupId: string | null;
  tags: string[];
  status: "todo" | "doing" | "done" | null;
  attachmentHashes: string[];
  source: string;
  rev: number;
  metaRev: number;
  contentHash: string;
  pinned: boolean;
  starred: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/** Memos cannot be encrypted or live in the private space (FR-ENC-1). */
export type Item = ItemFields & (
  | { type: "memo"; title: string | null; content: Extract<StoredContent, { scope: "plain" }> }
  | { type: "note" | "table"; title: string; content: StoredContent }
);

export interface Attachment {
  userId: string;
  sha256: string;
  size: number;
  mime: string;
  refCount: number;
}
