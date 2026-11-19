import { parseRecoveryCodeBinding, type RecoveryCodeState } from "@menote/shared";
import { claimRecoveryCodeStatement, readRecoveryCode } from "../db/recoveryCode";

export const getRecoveryCodeState = readRecoveryCode;

export async function claimRecoveryCode(db: D1Database, userId: string, value: unknown): Promise<RecoveryCodeState | null> {
  const input = value as { revision?: unknown; binding?: unknown } | null;
  const binding = parseRecoveryCodeBinding(input?.binding);
  const revision = input?.revision;
  if (!binding || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) return null;
  const claimed = await claimRecoveryCodeStatement(db, userId, revision, binding).first();
  return claimed ? { binding } : await readRecoveryCode(db, userId);
}
