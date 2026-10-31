import type { SchemaMigration, SchemaStatus } from "@menote/shared";
import { migrations } from "../db/migrations";
import { applyMigration, ensureLedger, readLedger } from "../db/schema";

/** A malformed registry cannot be used to claim an incompatible schema. */
function checkRegistry(registry: readonly SchemaMigration[]): void {
  const names = new Set<string>();
  for (const [index, migration] of registry.entries()) {
    if (migration.version !== index + 1 || !migration.name || names.has(migration.name)
        || migration.statements.length === 0) {
      throw new Error("Invalid migration registry");
    }
    names.add(migration.name);
  }
}

export function ledgerReady(applied: readonly Pick<SchemaMigration, "version" | "name">[], registry: readonly SchemaMigration[] = migrations): boolean {
  return applied.length === registry.length && applied.every((row, index) =>
    row.version === index + 1 && row.version === registry[index]?.version && row.name === registry[index]?.name);
}

export async function schemaStatus(
  db: D1Database, registry: readonly SchemaMigration[] = migrations,
): Promise<SchemaStatus> {
  checkRegistry(registry);
  await ensureLedger(db);
  const applied = await readLedger(db);
  if (applied.length > registry.length || applied.some((row, index) =>
    row.version !== index + 1 || row.version !== registry[index]?.version
      || row.name !== registry[index]?.name)) return "incompatible";
  return ledgerReady(applied, registry) ? "ready" : "pending";
}

export async function migrateSchema(
  db: D1Database, registry: readonly SchemaMigration[] = migrations,
): Promise<SchemaStatus> {
  checkRegistry(registry);
  for (;;) {
    const status = await schemaStatus(db, registry);
    if (status !== "pending") return status;
    const applied = await readLedger(db);
    const migration = registry[applied.length];
    if (!migration) continue; // Another request may have completed the final version.
    // A concurrent initializer can win after our read. A failed batch is retried
    // only when the ledger proves that this exact migration has committed.
    try {
      await applyMigration(db, migration);
    } catch (error) {
      const after = await readLedger(db);
      const winner = after[migration.version - 1];
      if (winner?.version !== migration.version || winner.name !== migration.name) throw error;
    }
  }
}
