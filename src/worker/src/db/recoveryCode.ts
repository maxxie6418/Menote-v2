import {
  base64ToBytes, type RecoveryCodeBinding, type RecoveryCodeState,
  type RecoveryCodeRotationRequest, type RecoveryCodeRotationState, type RecoveryCodeRotationWrap,
} from "@menote/shared";
import { toKeyWrap, type WrapRow } from "./keyWraps";

type RecoveryCodeRow = { binding_id: string | null; verifier_json: string | null; wrap_revision: number };

const recoveryOwners = {
  item: { table: "items", wraps: "item_key_wraps", ownerId: "item_id", revs: "owner.rev, owner.meta_rev" },
  topic: { table: "topic_nodes", wraps: "topic_key_wraps", ownerId: "topic_id", revs: "0, 0" },
} as const;
type RecoveryKind = keyof typeof recoveryOwners;
type RecoveryWrapRow = Omit<WrapRow, "wrapper"> & { id: string; wrapper: string | null };

export function recoveryCodeReadStatement(db: SqlDatabase, userId: string): SqlStatement {
  return db.prepare("SELECT binding_id, verifier_json, wrap_revision FROM account_recovery_codes WHERE user_id = ?").bind(userId);
}

export function recoveryBindingFromRow(row?: { binding_id?: unknown; verifier_json?: unknown }): RecoveryCodeBinding | null {
  return typeof row?.binding_id === "string" && typeof row.verifier_json === "string"
    ? { id: row.binding_id, verifier: JSON.parse(row.verifier_json) } : null;
}

export async function readRecoveryCode(db: SqlDatabase, userId: string): Promise<RecoveryCodeState> {
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
  db: SqlDatabase, userId: string, revision: number, binding: RecoveryCodeBinding,
): SqlStatement {
  return db.prepare(
    `INSERT INTO account_recovery_codes (user_id, binding_id, verifier_json)
     SELECT ?, ?, ? WHERE COALESCE((SELECT wrap_revision FROM account_recovery_codes WHERE user_id = ?), 0) = ?
     ON CONFLICT (user_id) DO UPDATE SET binding_id = excluded.binding_id, verifier_json = excluded.verifier_json
     WHERE account_recovery_codes.binding_id IS NULL
     RETURNING binding_id`,
  ).bind(userId, binding.id, JSON.stringify(binding.verifier), userId, revision);
}

function needsRecoveryWrap(kind: RecoveryKind): string {
  if (kind === "item") return "owner.enc_self = 1";
  // Older Workers could create the space row before writing its wraps. An entirely empty placeholder needs no key.
  return `owner.is_enc_space = 1 AND (
    EXISTS (SELECT 1 FROM topic_key_wraps WHERE user_id = owner.user_id AND topic_id = owner.id)
    OR EXISTS (SELECT 1 FROM topic_nodes child WHERE child.user_id = owner.user_id AND child.parent_id = owner.id)
    OR EXISTS (SELECT 1 FROM items WHERE user_id = owner.user_id AND (topic_id = owner.id OR group_id = owner.id))
  )`;
}

function readRotationWraps(db: SqlDatabase, userId: string, kind: RecoveryKind): SqlStatement {
  const { table, wraps, ownerId } = recoveryOwners[kind];
  return db.prepare(
    `SELECT owner.id, w.wrapper, w.kdf_salt, w.kdf_iterations, w.iv, w.ciphertext, w.generation, w.recovery_code_id
     FROM ${table} owner LEFT JOIN ${wraps} w
       ON w.user_id = owner.user_id AND w.${ownerId} = owner.id AND w.wrapper = 'recovery'
     WHERE owner.user_id = ? AND ${needsRecoveryWrap(kind)} ORDER BY owner.id`,
  ).bind(userId);
}

export async function readRecoveryCodeRotation(db: SqlDatabase, userId: string): Promise<RecoveryCodeRotationState | null> {
  const [state, items, topics] = await db.batch<RecoveryCodeRow | RecoveryWrapRow>([
    recoveryCodeReadStatement(db, userId), readRotationWraps(db, userId, "item"), readRotationWraps(db, userId, "topic"),
  ]);
  const row = state!.results[0] as RecoveryCodeRow | undefined;
  const wraps: RecoveryCodeRotationWrap[] = [];
  for (const [kind, results] of [["item", items!.results], ["topic", topics!.results]] as const) {
    for (const { id, wrapper, ...fields } of results as RecoveryWrapRow[]) {
      if (wrapper === null) return null;
      wraps.push({ kind, id, wrap: toKeyWrap({ wrapper, ...fields }) });
    }
  }
  return { revision: row?.wrap_revision ?? 0, binding: recoveryBindingFromRow(row), wraps };
}

function inventoryMatches(kind: RecoveryKind): string {
  const { table } = recoveryOwners[kind];
  const filter = `owner.user_id = wanted.user_id AND ${needsRecoveryWrap(kind)}`;
  // Scope/owner changes may occur independently of key-wrap changes. Check both again inside the write transaction.
  return `(SELECT COUNT(*) FROM ${table} owner WHERE ${filter}) = json_array_length(wanted.${kind}_ids)
    AND NOT EXISTS (
      SELECT owner.id FROM ${table} owner WHERE ${filter}
      EXCEPT SELECT value FROM json_each(wanted.${kind}_ids)
    )`;
}

function hex(base64: string): string {
  return Array.from(base64ToBytes(base64), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function rotateRecoveryCode(
  db: SqlDatabase, userId: string, previousId: string | null, input: RecoveryCodeRotationRequest, now: number,
): Promise<boolean> {
  // Every dependent statement must observe our own nonce. A failed compare-and-swap writes nothing,
  // even when a racing request sent the same replacement binding or an earlier response was lost.
  const nonce = crypto.randomUUID();
  const { binding, revision } = input;
  const itemWraps = input.wraps.filter((entry) => entry.kind === "item");
  const topicWraps = input.wraps.filter((entry) => entry.kind === "topic");
  const statements = [db.prepare(
    `WITH wanted(user_id, binding_id, verifier_json, revision, prior_id, nonce, item_ids, topic_ids) AS (VALUES (?, ?, ?, ?, ?, ?, ?, ?))
     INSERT INTO account_recovery_codes (user_id, binding_id, verifier_json, wrap_revision, rotation_nonce)
     SELECT user_id, binding_id, verifier_json, revision + 1, nonce FROM wanted
     WHERE COALESCE((SELECT wrap_revision FROM account_recovery_codes WHERE user_id = wanted.user_id), 0) = wanted.revision
       AND (SELECT binding_id FROM account_recovery_codes WHERE user_id = wanted.user_id) IS wanted.prior_id
       AND ${inventoryMatches("item")} AND ${inventoryMatches("topic")}
     ON CONFLICT(user_id) DO UPDATE SET binding_id = excluded.binding_id, verifier_json = excluded.verifier_json,
       wrap_revision = excluded.wrap_revision, rotation_nonce = excluded.rotation_nonce
     RETURNING binding_id`,
  ).bind(userId, binding.id, JSON.stringify(binding.verifier), revision, previousId, nonce,
    JSON.stringify(itemWraps.map(({ id }) => id)), JSON.stringify(topicWraps.map(({ id }) => id)))];
  const ownsRotation = "(SELECT rotation_nonce FROM account_recovery_codes WHERE user_id = ?) = ?";
  for (const [kind, entries] of [["item", itemWraps], ["topic", topicWraps]] as const) {
    const { table, wraps, ownerId, revs } = recoveryOwners[kind];
    // A single JSON parameter preserves the D1 binding limit while updating fixed-length BLOBs in groups.
    for (let offset = 0; offset < entries.length; offset += 250) {
      const chunk = entries.slice(offset, offset + 250).map(({ id, wrap }) => ({
        id, salt: hex(wrap.kdfSalt), iterations: wrap.kdfIterations, iv: hex(wrap.iv),
        ciphertext: hex(wrap.ciphertext), generation: wrap.generation,
      }));
      statements.push(db.prepare(
        `UPDATE ${wraps} AS w SET kdf_salt = unhex(entry.value ->> 'salt'), kdf_iterations = entry.value ->> 'iterations',
           iv = unhex(entry.value ->> 'iv'), ciphertext = unhex(entry.value ->> 'ciphertext'),
           generation = entry.value ->> 'generation', created_at = ?, recovery_code_id = ?
         FROM json_each(?) AS entry
         WHERE w.user_id = ? AND w.${ownerId} = entry.value ->> 'id' AND w.wrapper = 'recovery' AND ${ownsRotation}`,
      ).bind(now, binding.id, JSON.stringify(chunk), userId, userId, nonce));
    }
    if (entries.length > 0) {
      statements.push(db.prepare(
        `INSERT INTO sync_log (user_id, entity, entity_id, op, rev, meta_rev, created_at)
         SELECT ?, '${kind}', owner.id, 'upsert', ${revs}, ? FROM ${table} owner
         WHERE owner.user_id = ? AND owner.id IN (SELECT value FROM json_each(?)) AND ${ownsRotation}`,
      ).bind(userId, now, userId, JSON.stringify(entries.map(({ id }) => id)), userId, nonce));
    }
  }
  const [result] = await db.batch(statements);
  return result!.results.length > 0;
}

export function restoreRecoveryCodeStatements(db: SqlDatabase, userId: string, binding: RecoveryCodeBinding) {
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
