import { DatabaseSync } from "node:sqlite";

class Statement {
  constructor(owner, sql, values = []) {
    this.owner = owner;
    this.sql = sql;
    this.values = values;
  }

  bind(...values) {
    return new Statement(this.owner, this.sql, values.map(value =>
      value instanceof ArrayBuffer ? new Uint8Array(value) : typeof value === "boolean" ? Number(value) : value));
  }

  async all() { return this.owner.execute(this); }
  async run() { return this.owner.execute(this); }
  async first(column) {
    const [row] = (await this.all()).results;
    if (!row || column === undefined) return row ?? null;
    if (!Object.hasOwn(row, column)) throw new Error("Unknown SQLite result column");
    return row[column];
  }
}

export class LocalDatabase {
  constructor(file, migrationScripts) {
    this.db = new DatabaseSync(file, { enableForeignKeyConstraints: true });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000");
    this.migrations = new Set(migrationScripts);
  }

  prepare(sql) { return new Statement(this, sql); }

  execute(statement) {
    const { sql, values } = statement;
    if (statement.owner !== this) throw new Error("Statement belongs to another database");
    if (!values.length && this.migrations.has(sql)) {
      this.db.exec(sql);
      return { success: true, results: [], meta: { changes: 0 } };
    }
    const compiled = this.db.prepare(sql);
    if (compiled.columns().length) {
      const results = compiled.all(...values);
      return { success: true, results, meta: { changes: this.db.prepare("SELECT changes() AS n").get().n } };
    }
    const { changes } = compiled.run(...values);
    return { success: true, results: [], meta: { changes: Number(changes) } };
  }

  async batch(statements) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map(statement => this.execute(statement));
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close() { this.db.close(); }
}
