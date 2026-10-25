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

/** Changes between schema versions that older files are brought through when read (docs/12, "Schema migrations"). */
export const MIGRATIONS: { to: number; addColumns?: { table: TableName | "*"; column: string }[]; dropColumns?: { table: TableName; column: string }[] }[] = [
  // Every table with system columns gains basedOn.
  { to: 2, addColumns: [{ table: "*", column: "basedOn" }] },
  // Settings record the data mode and the storage account (docs/32, "Recording the backend").
  { to: 3, addColumns: [{ table: "settings", column: "dataMode" }, { table: "settings", column: "storageAccount" }] },
  // The agent check's settings moved to the CLI on each computer (docs/22). The agent_rules table went too; files
  // of tables the schema no longer has are not read.
  { to: 4, dropColumns: [{ table: "settings", column: "agentChecker" }, { table: "settings", column: "sendNotesToAgent" }] },
  // Every table with system columns gains versionVector, for merging edits field by field (docs/12). The new
  // sync_conflicts table starts empty: a missing table file is an empty table.
  { to: 5, addColumns: [{ table: "*", column: "versionVector" }] },
];

/** A table file written with an older schema version, brought up to this one. Newer or unknown files are left. */
export function upgradeTableFile(file: TableFile, table: TableName): TableFile {
  if (typeof file.schemaVersion !== "number" || file.schemaVersion >= SCHEMA_VERSION || !Array.isArray(file.columns)) return file;
  const columns = [...file.columns];
  let rows = file.rows ?? [];
  for (const step of MIGRATIONS) {
    if (step.to <= file.schemaVersion) continue;
    for (const add of step.addColumns ?? []) {
      if (add.table === "*" ? TABLES[table].kind === "points" : add.table !== table) continue;
      if (columns.includes(add.column)) continue;
      columns.push(add.column);
      rows = rows.map((r) => ({ ...r, [add.column]: null }));
    }
    for (const drop of step.dropColumns ?? []) {
      const at = columns.indexOf(drop.column);
      if (drop.table !== table || at < 0) continue;
      columns.splice(at, 1);
      rows = rows.map(({ [drop.column]: _, ...rest }) => rest);
    }
  }
  const expected = allColumns(TABLES[table]).map((c) => c.name);
  const same = columns.length === expected.length && expected.every((c) => columns.includes(c));
  return { ...file, schemaVersion: SCHEMA_VERSION, columns: same ? expected : columns, rows };
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
