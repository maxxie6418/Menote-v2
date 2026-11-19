import type { RecoveryCodeBinding, RecoveryCodeState } from "@menote/shared";
import { toKeyWrap, type WrapRow } from "./keyWraps";

type RecoveryCodeRow = { binding_id: string | null; verifier_json: string | null; wrap_revision: number };

export function recoveryCodeReadStatement(db: D1Database, userId: string): D1PreparedStatement {
  return db.prepare("SELECT binding_id, verifier_json, wrap_revision FROM account_recovery_codes WHERE user_id = ?").bind(userId);
}

export function recoveryBindingFromRow(row?: { binding_id?: unknown; verifier_json?: unknown }): RecoveryCodeBinding | null {
  return typeof row?.binding_id === "string" && typeof row.verifier_json === "string"
    ? { id: row.binding_id, verifier: JSON.parse(row.verifier_json) } : null;
}

export async function readRecoveryCode(db: D1Database, userId: string): Promise<RecoveryCodeState> {
  const current = await recoveryCodeReadStatement(db, userId).first<RecoveryCodeRow>();
  const binding = recoveryBindingFromRow(current ?? undefined);
  if (binding) return { binding };
  // The wrappers and revision must come from the same read transaction.
  const [state, items, topics] = await db.batch([
    recoveryCodeReadStatement(db, userId),
    db.prepare(`SELECT w.wrapper, w.kdf_salt, w.kdf_iterations, w.iv, w.ciphertext, w.generation
      FROM item_key_wraps w JOIN items i ON i.user_id = w.user_id AND i.id = w.item_id
      WHERE w.user_id = ? AND w.wrapper = 'recovery' AND i.enc_self = 1`).bind(userId),
    db.prepare(`SELECT w.wrapper, w.kdf_salt, w.kdf_iterations, w.iv, w.ciphertext, w.generation
      FROM topic_key_wraps w JOIN topic_nodes t ON t.user_id = w.user_id AND t.id = w.topic_id
      WHERE w.user_id = ? AND w.wrapper = 'recovery' AND t.is_enc_space = 1`).bind(userId),
  ]);
  const row = state?.results[0] as RecoveryCodeRow | undefined;
  const adopted = recoveryBindingFromRow(row);
  if (adopted) return { binding: adopted };
  return {
    binding: null, revision: row?.wrap_revision ?? 0,
    legacyWraps: [...items!.results, ...topics!.results].map((value) => toKeyWrap(value as unknown as WrapRow)),
  };
}

export function claimRecoveryCodeStatement(
  db: D1Database, userId: string, revision: number, binding: RecoveryCodeBinding,
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO account_recovery_codes (user_id, binding_id, verifier_json)
     SELECT ?, ?, ? WHERE COALESCE((SELECT wrap_revision FROM account_recovery_codes WHERE user_id = ?), 0) = ?
     ON CONFLICT (user_id) DO UPDATE SET binding_id = excluded.binding_id, verifier_json = excluded.verifier_json
     WHERE account_recovery_codes.binding_id IS NULL
     RETURNING binding_id`,
  ).bind(userId, binding.id, JSON.stringify(binding.verifier), userId, revision);
}

export function restoreRecoveryCodeStatements(db: D1Database, userId: string, binding: RecoveryCodeBinding) {
  // A bound snapshot may initialize an empty account, or merge into the same binding.
  // An unrelated existing verifier or any unverified legacy wrappers require a separate recovery environment.
  return [
    db.prepare(
      `SELECT CASE WHEN EXISTS (
         SELECT 1 FROM account_recovery_codes
         WHERE user_id = ? AND binding_id = ? AND verifier_json = ?
       ) OR (
         NOT EXISTS (SELECT 1 FROM account_recovery_codes WHERE user_id = ? AND binding_id IS NOT NULL)
         AND NOT EXISTS (SELECT 1 FROM item_key_wraps WHERE user_id = ? AND wrapper = 'recovery')
         AND NOT EXISTS (SELECT 1 FROM topic_key_wraps WHERE user_id = ? AND wrapper = 'recovery')
       ) THEN 1 ELSE json(?) END`,
    ).bind(userId, binding.id, JSON.stringify(binding.verifier), userId, userId, userId, "restore_recovery_binding_conflict"),
    db.prepare(
      `INSERT INTO account_recovery_codes (user_id, binding_id, verifier_json) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET binding_id = excluded.binding_id, verifier_json = excluded.verifier_json
       WHERE account_recovery_codes.binding_id IS NULL`,
    ).bind(userId, binding.id, JSON.stringify(binding.verifier)),
  ];
}
