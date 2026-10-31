/** Minimal account and topic metadata from the engineering design §5. */
export interface User {
  id: string;
  username: string;
  role: "owner" | "member";
  createdAt: number;
}

export interface TopicNode {
  id: string;
  userId: string;
  parentId: string | null;
  name: string;
  depth: 0 | 1;
  isEncSpace: boolean;
  deletedAt: number | null;
}
