// The server's database on any machine: Node's built-in SQLite, in a file.

import { DatabaseSync } from "node:sqlite";
import type { Database, SqlValue } from "./db.ts";

export function sqliteFile(path: string): Database {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const prep = (sql: string) => db.prepare(sql);
  return {
    all: async <T>(sql: string, params: SqlValue[] = []) => prep(sql).all(...params) as T[],
    first: async <T>(sql: string, params: SqlValue[] = []) => (prep(sql).get(...params) as T | undefined) ?? null,
    run: async (sql, params = []) => Number(prep(sql).run(...params).changes),
    batch: async (statements) => {
      db.exec("BEGIN");
      try {
        for (const s of statements) prep(s.sql).run(...(s.params ?? []));
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
