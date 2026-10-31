/** Memo fields specified in requirements §5.1. Timestamps are Unix milliseconds. */
export interface Memo {
  id: string;
  userId: string;
  content: string;
  tags: string[];
  status: "todo" | "doing" | "done" | null;
  /** Attachment references; object storage identifiers, not attachment data. */
  attachments: string[];
  source: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}
