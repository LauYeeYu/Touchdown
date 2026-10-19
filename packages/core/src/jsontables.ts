// The JSON tables file format (docs/12-storage-and-sync.md, "File backend: JSON tables"): one file per
// table with the column list once and every row with exactly those columns, plus a manifest.

import { allColumns } from "./schema/columns.ts";
import { SCHEMA_NAME, SCHEMA_VERSION, TABLES, type TableName } from "./schema/tables.ts";
import { validateRow } from "./schema/validate.ts";
import type { Store } from "./store.ts";

export interface TableFile {
  schema: typeof SCHEMA_NAME;
  schemaVersion: number;
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface Manifest {
  schema: typeof SCHEMA_NAME;
  schemaVersion: number;
  backend: "json_tables";
  tables: Record<string, string>;
  lastWriter: string;
}

/** Tables stored as files; track points live in tracks/<trackId>.json instead. */
export const FILE_TABLES = (Object.keys(TABLES) as TableName[]).filter((t) => t !== "track_points");

export function toTableFile(store: Store, table: TableName): TableFile {
  const columns = allColumns(TABLES[table]).map((c) => c.name);
  const rows = store.allWithDeleted(table).map((r) => Object.fromEntries(columns.map((c) => [c, (r as Record<string, unknown>)[c] ?? null])));
  return { schema: SCHEMA_NAME, schemaVersion: SCHEMA_VERSION, table, columns, rows };
}

export function manifestFor(store: Store): Manifest {
  return {
    schema: SCHEMA_NAME,
    schemaVersion: SCHEMA_VERSION,
    backend: "json_tables",
    tables: Object.fromEntries(FILE_TABLES.map((t) => [t, `tables/${t}.json`])),
    lastWriter: store.deviceId,
  };
}

export interface TableFileProblem {
  table: string;
  message: string;
}

/** Check a table file: header, exact columns, and every row against the schema. */
export function checkTableFile(file: unknown, table: TableName): TableFileProblem[] {
  const f = file as Partial<TableFile>;
  const problems: TableFileProblem[] = [];
  if (f.schema !== SCHEMA_NAME) problems.push({ table, message: "not a Touchdown table file" });
  if (f.table !== table) problems.push({ table, message: `holds table ${String(f.table)}` });
  const expected = allColumns(TABLES[table]).map((c) => c.name);
  if (JSON.stringify(f.columns) !== JSON.stringify(expected)) problems.push({ table, message: "column list differs from the schema" });
  for (const [i, row] of (f.rows ?? []).entries()) {
    for (const p of validateRow(table, row)) problems.push({ table, message: `row ${i + 1}: ${p.column} ${p.message}` });
    if (problems.length > 20) break;
  }
  return problems;
}

/** Serialise one table file: the header, then one row per line, so diffs stay readable. */
export function stringifyTableFile(f: TableFile): string {
  const head = JSON.stringify({ ...f, rows: [] }).replace(/\[\]\}$/, "");
  return `${head}[\n${f.rows.map((r) => "  " + JSON.stringify(r)).join(",\n")}\n]}\n`;
}
