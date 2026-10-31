/** Encoded version snapshot; encryption envelope format is deliberately unspecified in M1. */
export type VersionSnapshot =
  | { encrypted: false; data: string }
  | { encrypted: true; ciphertext: string };

export interface ItemVersion {
  id: string;
  userId: string;
  itemId: string;
  snapshot: VersionSnapshot;
  codec: "identity" | "gzip";
  reason: string;
  createdAt: number;
}
