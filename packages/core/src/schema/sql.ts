// SQL table definitions generated from the schema, for the SQLite file backend, Cloudflare D1 and Postgres
// (docs/10-domain-model.md, "Logical types").

import { allColumns, snakeCase, type ColumnDef, type TableDef } from "./columns.ts";

export type SqlDialect = "sqlite" | "postgres";

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

function sqliteColumn(col: ColumnDef): string[] {
  const name = snakeCase(col.name);
  const notNull = col.required ? " NOT NULL" : "";
  const out: string[] = [];
  switch (col.type) {
    case "id":
      out.push(name === "id" ? `id TEXT PRIMARY KEY` : `${name} TEXT${notNull}`);
      break;
    case "text":
    case "ref":
    case "json":
      out.push(`${name} TEXT${notNull}${col.unique ? " UNIQUE" : ""}`);
      break;
    case "integer":
      out.push(`${name} INTEGER${notNull}`);
      break;
    case "real":
      out.push(`${name} REAL${notNull}`);
      break;
    case "boolean":
      out.push(`${name} INTEGER${notNull} CHECK (${name} IN (0, 1))`);
      break;
    case "date":
      out.push(`${name} TEXT${notNull} CHECK (${name} GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')`);
      break;
    case "datetime":
      out.push(`${name} TEXT${notNull}`);
      // SQLite's date functions read the UTC offset, so the instant can be indexed and sorted.
      out.push(`${name}_utc INTEGER GENERATED ALWAYS AS (unixepoch(${name})) STORED`);
      break;
    case "enum":
      out.push(`${name} TEXT${notNull} CHECK (${name} IN (${col.values!.map(q).join(", ")}))`);
      break;
  }
  return out;
}

function postgresColumn(col: ColumnDef): string[] {
  const name = snakeCase(col.name);
  const notNull = col.required ? " NOT NULL" : "";
  switch (col.type) {
    case "id":
      return [name === "id" ? `id text PRIMARY KEY` : `${name} text${notNull}`];
    case "text":
    case "ref":
      return [`${name} text${notNull}${col.unique ? " UNIQUE" : ""}`];
    case "json":
      return [`${name} jsonb${notNull}`];
    case "integer":
      return [`${name} bigint${notNull}`];
    case "real":
      return [`${name} double precision${notNull}`];
    case "boolean":
      return [`${name} boolean${notNull}`];
    case "date":
      return [`${name} date${notNull}`];
    case "datetime":
      // Never timestamptz alone: it drops the local offset. Keep the text and index the instant.
      return [`${name} text${notNull}`, `${name}_utc timestamptz GENERATED ALWAYS AS (touchdown_instant(${name})) STORED`];
    case "enum":
      return [`${name} text${notNull} CHECK (${name} IN (${col.values!.map(q).join(", ")}))`];
  }
}

export function createTableSql(t: TableDef, dialect: SqlDialect): string {
  const cols = allColumns(t);
  const lines = cols.flatMap((col) => (dialect === "sqlite" ? sqliteColumn(col) : postgresColumn(col)));
  if (t.kind === "points") lines.push(`PRIMARY KEY (track_id, seq)`);
  for (const col of cols) {
    if (col.type === "ref" && col.ref && !["operators", "airports", "aircraft_types", "families"].includes(col.ref)) {
      // Reference tables ship with the app and are not stored, so only user tables get foreign keys.
      lines.push(`FOREIGN KEY (${snakeCase(col.name)}) REFERENCES ${col.ref}(id)`);
    }
  }
  const body = lines.map((l) => "  " + l).join(",\n");
  const out = [`CREATE TABLE IF NOT EXISTS ${t.name} (\n${body}\n);`];
  for (const col of cols) {
    if (col.type === "datetime") {
      const n = snakeCase(col.name);
      out.push(`CREATE INDEX IF NOT EXISTS ${t.name}_${n}_utc ON ${t.name} (${n}_utc);`);
    }
  }
  return out.join("\n");
}

export function schemaSql(tables: readonly TableDef[], dialect: SqlDialect): string {
  const pre =
    dialect === "postgres"
      ? [
          `CREATE OR REPLACE FUNCTION touchdown_instant(t text) RETURNS timestamptz`,
          `  LANGUAGE sql IMMUTABLE AS $$ SELECT t::timestamptz $$;`,
        ].join("\n")
      : "";
  const meta =
    dialect === "sqlite"
      ? `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);`
      : `CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text);`;
  return [pre, meta, ...tables.map((t) => createTableSql(t, dialect))].filter(Boolean).join("\n\n") + "\n";
}
