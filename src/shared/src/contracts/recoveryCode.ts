import { base64ToBytes } from "../bytes";
import type { RecoveryCodeBinding } from "./sync";

/** The verifier wraps a random 32-byte key using the existing recovery-code KDF. */
export function parseRecoveryCodeBinding(value: unknown): RecoveryCodeBinding | null {
  const binding = value as Partial<RecoveryCodeBinding> | null;
  const wrap = binding?.verifier;
  if (typeof binding?.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(binding.id) ||
    !wrap || wrap.wrapper !== "recovery" || wrap.kdfIterations !== 600_000 || wrap.generation !== 0 ||
    typeof wrap.kdfSalt !== "string" || wrap.kdfSalt.length !== 24 ||
    typeof wrap.iv !== "string" || wrap.iv.length !== 16 ||
    typeof wrap.ciphertext !== "string" || wrap.ciphertext.length !== 64) return null;
  try {
    if (base64ToBytes(wrap.kdfSalt).length !== 16 || base64ToBytes(wrap.iv).length !== 12 ||
      base64ToBytes(wrap.ciphertext).length !== 48) return null;
  } catch { return null; }
  return { id: binding.id, verifier: {
    wrapper: "recovery", kdfSalt: wrap.kdfSalt, kdfIterations: wrap.kdfIterations,
    iv: wrap.iv, ciphertext: wrap.ciphertext, generation: 0,
  } };
}
