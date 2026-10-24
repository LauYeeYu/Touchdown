// The server's database (docs/33-accounts-and-sign-in.md, "Server tables"): SQLite, as Cloudflare D1 or a file
// with the Node server. The server code sees only this interface, so it runs on either.

export type SqlValue = string | number | null;

export interface Statement {
  sql: string;
  params?: SqlValue[];
}

export interface Database {
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
  /** Returns how many rows changed. */
  run(sql: string, params?: SqlValue[]): Promise<number>;
  /** Several writes, all or none. */
  batch(statements: Statement[]): Promise<void>;
}

export const SERVER_SCHEMA_VERSION = 1;

/** The server's tables. Removing a row never relies on cascades: the code deletes dependent rows itself. */
const TABLES = [
  `CREATE TABLE IF NOT EXISTS site (
    id TEXT PRIMARY KEY,
    createdAt TEXT NOT NULL,
    schemaVersion INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
    createdAt TEXT NOT NULL,
    lastSeenAt TEXT,
    failedSignins INTEGER NOT NULL DEFAULT 0,
    lockedUntil TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS password_credentials (
    accountId TEXT PRIMARY KEY,
    salt TEXT NOT NULL,
    hash TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS google_identities (
    accountId TEXT PRIMARY KEY,
    sub TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    linkedAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    tokenHash TEXT PRIMARY KEY,
    accountId TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    lastUsedAt TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    device TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_account ON sessions (accountId)`,
  `CREATE TABLE IF NOT EXISTS invites (
    id TEXT PRIMARY KEY,
    tokenHash TEXT NOT NULL UNIQUE,
    purpose TEXT NOT NULL CHECK (purpose IN ('join', 'reset')),
    accountId TEXT,
    note TEXT,
    createdBy TEXT,
    createdAt TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    usedAt TEXT,
    usedBy TEXT
  )`,
  // One row per Google sign-in under way, used once, for 10 minutes (docs/33, "Google").
  `CREATE TABLE IF NOT EXISTS google_logins (
    stateHash TEXT PRIMARY KEY,
    nonce TEXT NOT NULL,
    verifier TEXT NOT NULL,
    next TEXT,
    invite TEXT,
    name TEXT,
    linkAccountId TEXT,
    expiresAt TEXT NOT NULL
  )`,
];

const ready = new WeakMap<Database, Promise<string>>();

/** Create the tables when missing, once per database object. Resolves to the site id. */
export function siteId(db: Database, makeId: () => string, now: string): Promise<string> {
  let p = ready.get(db);
  if (!p) {
    p = (async () => {
      await db.batch(TABLES.map((sql) => ({ sql })));
      await db.run("INSERT OR IGNORE INTO site (id, createdAt, schemaVersion) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM site)", [makeId(), now, SERVER_SCHEMA_VERSION]);
      const row = await db.first<{ id: string }>("SELECT id FROM site LIMIT 1");
      return row!.id;
    })();
    p.catch(() => ready.delete(db));
    ready.set(db, p);
  }
  return p;
}

// ---------- Cloudflare D1 ----------

interface D1Statement {
  bind(...values: SqlValue[]): D1Statement;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes?: number } }>;
}

/** The parts of Cloudflare's D1 binding the server uses. */
export interface D1Like {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown>;
}

export function d1Database(d1: D1Like): Database {
  const stmt = (sql: string, params: SqlValue[] = []) => d1.prepare(sql).bind(...params);
  return {
    all: async <T>(sql: string, params?: SqlValue[]) => (await stmt(sql, params).all<T>()).results,
    first: <T>(sql: string, params?: SqlValue[]) => stmt(sql, params).first<T>(),
    run: async (sql, params) => (await stmt(sql, params).run()).meta.changes ?? 0,
    batch: async (statements) => {
      // D1 runs a batch as one transaction.
      await d1.batch(statements.map((s) => stmt(s.sql, s.params)));
    },
  };
}
