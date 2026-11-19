import { parseRecoveryCodeBinding, parseRecoveryCodeRotation, type RecoveryCodeState } from "@menote/shared";
import { claimRecoveryCodeStatement, readRecoveryCode, readRecoveryCodeRotation, rotateRecoveryCode } from "../db/recoveryCode";

export const getRecoveryCodeState = readRecoveryCode;
export const getRecoveryCodeRotation = readRecoveryCodeRotation;

export async function claimRecoveryCode(db: D1Database, userId: string, value: unknown): Promise<RecoveryCodeState | null> {
  const input = value as { revision?: unknown; binding?: unknown } | null;
  const binding = parseRecoveryCodeBinding(input?.binding);
  const revision = input?.revision;
  if (!binding || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) return null;
  const claimed = await claimRecoveryCodeStatement(db, userId, revision, binding).first();
  return claimed ? { binding } : await readRecoveryCode(db, userId);
}

export async function commitRecoveryCodeRotation(db: D1Database, userId: string, value: unknown, now: number) {
  const input = parseRecoveryCodeRotation(value);
  if (!input) return { error: "invalid_recovery_rotation" } as const;
  const current = await readRecoveryCodeRotation(db, userId);
  if (!current) return { error: "recovery_code_wrap_missing" } as const;
  if (!current.binding && current.wraps.length === 0) return { error: "invalid_recovery_rotation" } as const;
  const priorId = current.binding?.id ?? null;
  if (input.revision !== current.revision || input.binding.id === priorId || input.wraps.length !== current.wraps.length) {
    return { error: "recovery_code_revision_changed" } as const;
  }
  const priorWraps = new Map(current.wraps.map(({ kind, id, wrap }) => [`${kind}:${id}`, wrap]));
  for (const { kind, id, wrap } of input.wraps) {
    const before = priorWraps.get(`${kind}:${id}`);
    if (!before || wrap.generation !== before.generation + 1) return { error: "recovery_code_revision_changed" } as const;
    if (wrap.ciphertext === before.ciphertext) return { error: "invalid_recovery_rotation" } as const;
  }
  if (input.binding.verifier.ciphertext === current.binding?.verifier.ciphertext) {
    return { error: "invalid_recovery_rotation" } as const;
  }
  return await rotateRecoveryCode(db, userId, priorId, input, now)
    ? { binding: input.binding } : { error: "recovery_code_revision_changed" } as const;
}
