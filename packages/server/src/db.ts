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

export const SERVER_SCHEMA_VERSION = 4;

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
    device TEXT,
    kind TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_account ON sessions (accountId)`,
  // The command line's sign-in under way (docs/33, "The command line"): a one-time code for its PKCE challenge.
  `CREATE TABLE IF NOT EXISTS cli_logins (
    codeHash TEXT PRIMARY KEY,
    accountId TEXT NOT NULL,
    challenge TEXT NOT NULL,
    system TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    expiresAt TEXT NOT NULL
  )`,
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
    expiresAt TEXT NOT NULL,
    purpose TEXT
  )`,
  // Standard mode (docs/32, "What the server stores"): one storage connection per account, its key encrypted.
  `CREATE TABLE IF NOT EXISTS storage_connections (
    id TEXT PRIMARY KEY,
    accountId TEXT NOT NULL UNIQUE,
    backend TEXT NOT NULL,
    format TEXT NOT NULL,
    location TEXT,
    externalAccount TEXT,
    scope TEXT NOT NULL,
    tokenCiphertext TEXT NOT NULL,
    tokenIv TEXT NOT NULL,
    tokenKeyId TEXT NOT NULL,
    tokenFormat INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ok', 'broken')),
    statusAt TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    lastUsedAt TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS consents (
    accountId TEXT NOT NULL,
    termsVersion INTEGER NOT NULL,
    acceptedAt TEXT NOT NULL,
    PRIMARY KEY (accountId, termsVersion)
  )`,
  // Share links (docs/32, "What the server stores"): a link names its record only by id, never anything from the log.
  // One link per thing: the whole log's has an empty subject.
  `CREATE TABLE IF NOT EXISTS shares (
    id TEXT PRIMARY KEY,
    accountId TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('flight', 'sighting', 'aircraft', 'log')),
    subject TEXT NOT NULL,
    anchor TEXT,
    createdAt TEXT NOT NULL,
    timesOpened INTEGER NOT NULL DEFAULT 0,
    lastOpenedAt TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS shares_thing ON shares (accountId, kind, subject)`,
];

/** Changes to tables made by an older version, by the version that brings them. New tables need none. */
const MIGRATIONS: { to: number; run: (db: Database) => Promise<void> }[] = [
  {
    // Google sign-ins under way say what they are for: signing in, or connecting storage for Standard mode.
    to: 2,
    run: async (db) => {
      try {
        await db.first("SELECT purpose FROM google_logins LIMIT 1");
      } catch {
        await db.run("ALTER TABLE google_logins ADD COLUMN purpose TEXT");
      }
    },
  },
  {
    // Sessions say whether they are a browser's (NULL) or the command line's ('cli').
    to: 3,
    run: async (db) => {
      try {
        await db.first("SELECT kind FROM sessions LIMIT 1");
      } catch {
        await db.run("ALTER TABLE sessions ADD COLUMN kind TEXT");
      }
    },
  },
];

const ready = new WeakMap<Database, Promise<string>>();

/** Create the tables when missing, once per database object. Resolves to the site id. */
export function siteId(db: Database, makeId: () => string, now: string): Promise<string> {
  let p = ready.get(db);
  if (!p) {
    p = (async () => {
      await db.batch(TABLES.map((sql) => ({ sql })));
      await db.run("INSERT OR IGNORE INTO site (id, createdAt, schemaVersion) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM site)", [makeId(), now, SERVER_SCHEMA_VERSION]);
      const row = await db.first<{ id: string; schemaVersion: number }>("SELECT id, schemaVersion FROM site LIMIT 1");
      for (const m of MIGRATIONS) if (m.to > row!.schemaVersion) await m.run(db);
      if (row!.schemaVersion < SERVER_SCHEMA_VERSION) await db.run("UPDATE site SET schemaVersion = ?", [SERVER_SCHEMA_VERSION]);
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
