// Table files from an older schema version, brought up to this one as they are read (docs/12, "Schema migrations").
// It depends on the schema alone, so the share server can read a log with it without the rest of core.

import { allColumns } from "./columns.ts";
import { SCHEMA_NAME, SCHEMA_VERSION, TABLES, type TableName } from "./tables.ts";

export interface TableFile {
  schema: typeof SCHEMA_NAME;
  schemaVersion: number;
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
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
  // A sighting holds every status it was seen in, in the new sighting_phases table. Each sighting's phase, and
  // statuses an older import kept in its notes ("Also taxiing"), are moved into it after the first pull (core
  // phases.ts, settleOlder).
  { to: 6 },
  // Private data apart (docs/32, "Private data"): the new flight_private table starts empty, and each flight's ticket
  // number and booking reference are moved into it after the first pull (core private.ts, settleOlder). The JSON
  // tables backend keeps private tables in private/ and moves their files there from tables/ when it opens.
  { to: 7 },
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
