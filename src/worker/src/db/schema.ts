import type { SchemaMigration } from "@menote/shared";

/** Create only the version ledger. No business schema is changed here. */
export async function ensureLedger(db: D1Database): Promise<void> {
  await db.prepare(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY CHECK (version > 0),
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

export async function readLedger(db: D1Database) {
  const result = await db.prepare(
    "SELECT version, name FROM schema_migrations ORDER BY version",
  ).all<{ version: number; name: string }>();
  return result.results;
}

/** Claim and apply a version in one D1 transaction. */
export async function applyMigration(db: D1Database, migration: SchemaMigration): Promise<void> {
  const claim = db.prepare(`INSERT INTO schema_migrations (version, name)
    SELECT ?, CASE WHEN COUNT(*) = ? AND COALESCE(MAX(version), 0) = ?
      THEN ? ELSE NULL END FROM schema_migrations`)
    .bind(migration.version, migration.version - 1, migration.version - 1, migration.name);
  await db.batch([claim, ...migration.statements.map((sql) => db.prepare(sql))]);
}
