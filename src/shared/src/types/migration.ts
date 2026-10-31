/** A migration is immutable once released; each SQL string is one D1 statement. */
export interface SchemaMigration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

export type SchemaStatus = "ready" | "pending" | "incompatible";
