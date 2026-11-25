const REQUEST_TIMEOUT_MS = 30_000;

function encodeParameter(value) {
  if (value == null || typeof value === "string" || typeof value === "number") return value ?? null;
  if (typeof value === "boolean") return Number(value);
  if (value instanceof ArrayBuffer) return Array.from(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) {
    return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  throw new TypeError("Unsupported D1 parameter");
}

function decodeRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) =>
    [key, Array.isArray(value) ? Uint8Array.from(value) : value]));
}

class Statement {
  constructor(database, sql, params = []) {
    this.database = database;
    this.query = { sql, params };
  }

  bind(...values) {
    return new Statement(this.database, this.query.sql, values.map(encodeParameter));
  }

  async all() {
    const [result] = await this.database.execute(this.query);
    return result;
  }

  async first(column) {
    const { results } = await this.all();
    const row = results[0];
    if (!row || column === undefined) return row ?? null;
    if (!Object.hasOwn(row, column)) throw new Error("D1 result column was not found");
    return row[column];
  }

  run() {
    return this.all();
  }
}

export class D1HttpDatabase {
  constructor(account, database, token, fetcher = fetch) {
    this.endpoint = "https://api.cloudflare.com/client/v4/accounts/" +
      encodeURIComponent(account) + "/d1/database/" + encodeURIComponent(database) + "/query";
    this.headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    this.fetcher = fetcher;
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  async batch(statements) {
    if (!statements.length) return [];
    const batch = statements.map((statement) => {
      if (!(statement instanceof Statement) || statement.database !== this) {
        throw new TypeError("D1 batch statement belongs to another database");
      }
      return statement.query;
    });
    // D1 runs all statements in one server-side transaction. Avoid retrying an
    // ambiguous POST at this layer. The application already tracks sync operation IDs.
    return this.execute({ batch });
  }

  async execute(query) {
    const response = await this.fetcher(this.endpoint, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(query),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`D1 request failed (HTTP ${response.status})`);
    }
    const { success, result } = await response.json();
    if (!success || !Array.isArray(result) || result.length === 0 ||
        result.some((entry) => !entry.success || !Array.isArray(entry.results))) {
      throw new Error("D1 query failed");
    }
    if (query.batch && result.length < query.batch.length) {
      throw new Error("Unexpected D1 batch result");
    }
    return result.map((entry) => ({ ...entry, results: entry.results.map(decodeRow) }));
  }
}
