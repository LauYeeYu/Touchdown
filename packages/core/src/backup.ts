// Backup files (docs/21-import-export.md): a zip of the JSON tables folder, with every table and private
// fields included, restorable into either file backend. CSV exports per table, flattened.

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { FILE_TABLES, checkTableFile, manifestFor, stringifyTableFile, tableFilePath, toTableFile, upgradeTableFile, type TableFile } from "./jsontables.ts";
import { privateIndex } from "./private.ts";
import { allColumns } from "./schema/columns.ts";
import { PRIVATE_FIELDS, SCHEMA_NAME, SCHEMA_VERSION, TABLES, type TableName } from "./schema/tables.ts";
import type { Store } from "./store.ts";

export function backupZip(store: Store): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "Touchdown/manifest.json": strToU8(JSON.stringify(manifestFor(store), null, 2) + "\n"),
  };
  // As the folder in the storage is laid out: private tables in private/ (docs/12).
  for (const t of FILE_TABLES) files[`Touchdown/${tableFilePath(t)}`] = strToU8(stringifyTableFile(toTableFile(store, t)));
  // Track points are stored per track (docs/12), so each track's points go in their own file.
  const points = toTableFile(store, "track_points");
  const byTrack = new Map<string, Record<string, unknown>[]>();
  for (const r of points.rows) byTrack.set(String(r.trackId), [...(byTrack.get(String(r.trackId)) ?? []), r]);
  for (const [trackId, rows] of byTrack) files[`Touchdown/tracks/${trackId}.json`] = strToU8(stringifyTableFile({ ...points, rows }));
  return zipSync(files, { level: 6 });
}

export interface BackupContents {
  tables: Map<TableName, Record<string, unknown>[]>;
  problems: string[];
  schemaVersion: number | null;
}

/** Read a backup zip. Files are checked against the schema; invalid tables are reported, not loaded. */
export function readBackup(data: Uint8Array): BackupContents {
  const files = unzipSync(data);
  const out: BackupContents = { tables: new Map(), problems: [], schemaVersion: null };
  const find = (suffix: string) => Object.keys(files).find((k) => k === suffix || k.endsWith("/" + suffix));
  const manifestPath = find("manifest.json");
  if (!manifestPath) {
    out.problems.push("No manifest.json: this is not a Touchdown backup.");
    return out;
  }
  const manifest = JSON.parse(strFromU8(files[manifestPath]!)) as { schema?: string; schemaVersion?: number };
  if (manifest.schema !== SCHEMA_NAME) {
    out.problems.push("The manifest is not a Touchdown manifest.");
    return out;
  }
  out.schemaVersion = manifest.schemaVersion ?? null;
  if ((manifest.schemaVersion ?? 0) > SCHEMA_VERSION) {
    out.problems.push(`The backup uses schema version ${manifest.schemaVersion}, and this app understands only up to ${SCHEMA_VERSION}. Reload the app to update it.`);
    return out;
  }
  const base = manifestPath.slice(0, -"manifest.json".length);
  for (const t of FILE_TABLES) {
    // A backup from before version 7 keeps every table in tables/.
    const path = [`${base}${tableFilePath(t)}`, `${base}tables/${t}.json`].find((p) => files[p]);
    if (!path) continue;
    const file = upgradeTableFile(JSON.parse(strFromU8(files[path]!)) as TableFile, t);
    const problems = checkTableFile(file, t);
    if (problems.length) out.problems.push(...problems.map((p) => `${p.table}: ${p.message}`));
    else out.tables.set(t, file.rows);
  }
  const points: Record<string, unknown>[] = [];
  for (const path of Object.keys(files)) {
    if (!path.startsWith(`${base}tracks/`) || !path.endsWith(".json")) continue;
    const file = upgradeTableFile(JSON.parse(strFromU8(files[path]!)) as TableFile, "track_points");
    const problems = checkTableFile(file, "track_points");
    if (problems.length) out.problems.push(...problems.map((p) => `${path}: ${p.message}`));
    else points.push(...file.rows);
  }
  if (points.length) out.tables.set("track_points", points);
  return out;
}

/** A cell that a spreadsheet would run as a formula gets a leading apostrophe (docs/30, security). */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * One table as CSV. Private fields only when asked for: a flight's come from its private row (docs/32, "Private
 * data"). Tombstones are left out.
 */
export function tableCsv(store: Store, table: TableName, includePrivate = false): string {
  const cols = allColumns(TABLES[table])
    .map((c) => c.name)
    .filter((c) => includePrivate || !PRIVATE_FIELDS.includes(`${table}.${c}`))
    .filter((c) => c !== "deleted" && c !== "basedOn" && c !== "versionVector");
  const lines = [cols.join(",")];
  const priv = table === "flights" && includePrivate ? privateIndex(store) : null;
  for (const r of store.all(table)) {
    const row = priv ? { ...r, ...priv.get(r.id) } : r;
    lines.push(cols.map((c) => csvCell((row as Record<string, unknown>)[c])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
