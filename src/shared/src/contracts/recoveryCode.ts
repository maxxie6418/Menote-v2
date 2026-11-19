import { base64ToBytes } from "../bytes";
import type { KeyWrap, RecoveryCodeBinding } from "./sync";

export interface RecoveryCodeRotationWrap {
  kind: "item" | "topic";
  id: string;
  wrap: KeyWrap;
}

export interface RecoveryCodeRotationState {
  revision: number;
  binding: RecoveryCodeBinding | null;
  wraps: RecoveryCodeRotationWrap[];
}

export interface RecoveryCodeRotationRequest extends RecoveryCodeRotationState {
  binding: RecoveryCodeBinding;
}

/** The verifier wraps a random 32-byte key using the existing recovery-code KDF. */
export function parseRecoveryCodeBinding(value: unknown): RecoveryCodeBinding | null {
  const binding = value as Partial<RecoveryCodeBinding> | null;
  if (typeof binding?.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(binding.id)) return null;
  const verifier = parseRecoveryWrap(binding.verifier, 0);
  return verifier ? { id: binding.id, verifier } : null;
}

function parseRecoveryWrap(value: unknown, generation: number): KeyWrap | null {
  const wrap = value as Partial<KeyWrap> | null;
  if (wrap?.wrapper !== "recovery" || wrap.kdfIterations !== 600_000 || wrap.generation !== generation ||
    typeof wrap.kdfSalt !== "string" || wrap.kdfSalt.length !== 24 ||
    typeof wrap.iv !== "string" || wrap.iv.length !== 16 ||
    typeof wrap.ciphertext !== "string" || wrap.ciphertext.length !== 64) return null;
  try {
    if (base64ToBytes(wrap.kdfSalt).length !== 16 || base64ToBytes(wrap.iv).length !== 12 ||
      base64ToBytes(wrap.ciphertext).length !== 48) return null;
  } catch { return null; }
  return {
    wrapper: "recovery", kdfSalt: wrap.kdfSalt, kdfIterations: wrap.kdfIterations,
    iv: wrap.iv, ciphertext: wrap.ciphertext, generation,
  };
}

export function parseRecoveryCodeRotation(value: unknown): RecoveryCodeRotationRequest | null {
  const input = value as Partial<RecoveryCodeRotationRequest> | null;
  const binding = parseRecoveryCodeBinding(input?.binding);
  const revision = input?.revision;
  if (!binding || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0 || !Array.isArray(input?.wraps)) return null;
  const wraps: RecoveryCodeRotationWrap[] = [];
  const entries = new Set<string>();
  for (const entry of input.wraps as Array<Partial<RecoveryCodeRotationWrap> | null>) {
    if ((entry?.kind !== "item" && entry?.kind !== "topic") || typeof entry.id !== "string" || !entry.id) return null;
    const key = `${entry.kind}:${entry.id}`;
    const generation = entry.wrap?.generation;
    if (entries.has(key) || typeof generation !== "number" || !Number.isSafeInteger(generation) || generation < 1 ||
      entry.wrap?.recoveryCodeId !== binding.id) return null;
    const wrap = parseRecoveryWrap(entry.wrap, generation);
    if (!wrap) return null;
    entries.add(key);
    wraps.push({ kind: entry.kind, id: entry.id, wrap: { ...wrap, recoveryCodeId: binding.id } });
  }
  return { binding, revision, wraps };
}
