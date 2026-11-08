// Backup files (docs/21-import-export.md): a zip of the JSON tables folder, with every table and private
// fields included, restorable into either file backend. CSV exports per table, flattened.

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { t } from "@touchdown/i18n";
import { FILE_TABLES, checkTableFile, manifestFor, stringifyTableFile, tableFilePath, toTableFile, upgradeTableFile, type TableFile } from "./jsontables.ts";
import { privateIndex } from "./private.ts";
import { allColumns } from "./schema/columns.ts";
import { PRIVATE_FIELDS, SCHEMA_NAME, SCHEMA_VERSION, TABLES, type TableName } from "./schema/tables.ts";
import { rowVersion, type Store } from "./store.ts";
import { fnv1a } from "./ids.ts";
import { addDays } from "./time/index.ts";

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

// ---------- daily copies (docs/12, "Daily copies") ----------

/**
 * The points in time the daily copies keep the log at: the end of each of the last 7 days, of the last 8 weeks, of
 * the last 12 months, and of every year before.
 */
export const DAILY_COPIES = { days: 7, weeks: 8, months: 12 } as const;

const COPY_NAME = /^touchdown-backup-(\d{4}-\d{2}-\d{2})-([0-9a-f]{8})\.zip$/;

/** A daily copy's file name: the day it was made and the fingerprint of the log it holds. */
export function dailyCopyName(day: string, fingerprint: string): string {
  return `touchdown-backup-${day}-${fingerprint}.zip`;
}

/** The day and fingerprint of a daily copy's file name, or null for any other file. */
export function parseDailyCopyName(name: string): { day: string; fingerprint: string } | null {
  const m = COPY_NAME.exec(name);
  return m ? { day: m[1]!, fingerprint: m[2]! } : null;
}

/**
 * What the log holds, as eight hex digits: the same for the same rows (their versions, tombstones included) and
 * recorded tracks, on any device. A copy is made only when it differs from the newest copy's.
 */
export function logFingerprint(store: Store): string {
  const parts: string[] = [];
  for (const table of FILE_TABLES) {
    for (const r of store.allWithDeleted(table)) parts.push(`${table}:${String((r as { id?: unknown }).id)}:${rowVersion(r as Record<string, unknown>)}`);
  }
  const points = new Map<string, number>();
  for (const p of store.all("track_points")) points.set(p.trackId, (points.get(p.trackId) ?? 0) + 1);
  for (const [trackId, n] of points) parts.push(`points:${trackId}:${n}`);
  return fnv1a(parts.sort().join("\n"));
}

/** The Sunday that ends a date's week (weeks start on Monday). */
function weekEnd(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDays(day, 6 - weekday);
}

/** The last day of the month `back` months before the date's. */
function monthEnd(day: string, back: number): string {
  const index = Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1 - back;
  const next = `${Math.floor((index + 1) / 12)}-${String(((index + 1) % 12) + 1).padStart(2, "0")}-01`;
  return addDays(next, -1);
}

/**
 * The daily copies to keep on `today`, of the files given (other files are not copies and are left alone). Copies are
 * made only on days the log changed, so none is kept for being a set number of days old: for each point in time
 * (the end of each of the last 7 days, of the last 8 weeks, of the last 12 months and of every year before), the
 * newest copy made on or before it is kept, which holds the log as it was then. Of two copies made on one day, the
 * later name counts as the newer, so every device keeps the same ones. A copy dated after today is kept.
 */
export function dailyCopiesToKeep(names: string[], today: string): Set<string> {
  const copies = names
    .map((name) => ({ name, day: parseDailyCopyName(name)?.day }))
    .filter((c): c is { name: string; day: string } => !!c.day)
    .sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name));
  // A copy dated after today comes from a device whose clock is ahead: it waits until its day is past here too.
  const keep = new Set(copies.filter((c) => c.day > today).map((c) => c.name));
  const past = copies.filter((c) => c.day <= today);
  if (!past.length) return keep;
  const points = new Set<string>();
  for (let i = 0; i < DAILY_COPIES.days; i++) points.add(addDays(today, -i));
  for (let i = 0; i < DAILY_COPIES.weeks; i++) points.add(addDays(weekEnd(today), -7 * i));
  for (let i = 0; i < DAILY_COPIES.months; i++) points.add(monthEnd(today, i));
  for (let y = Number(past[0]!.day.slice(0, 4)); y <= Number(today.slice(0, 4)); y++) points.add(`${y}-12-31`);
  for (const point of points) {
    const at = point > today ? today : point;
    const newest = past.findLast((c) => c.day <= at);
    if (newest) keep.add(newest.name);
  }
  return keep;
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
    out.problems.push(t("core.backup.noManifest"));
    return out;
  }
  const manifest = JSON.parse(strFromU8(files[manifestPath]!)) as { schema?: string; schemaVersion?: number };
  if (manifest.schema !== SCHEMA_NAME) {
    out.problems.push(t("core.backup.notManifest"));
    return out;
  }
  out.schemaVersion = manifest.schemaVersion ?? null;
  if ((manifest.schemaVersion ?? 0) > SCHEMA_VERSION) {
    out.problems.push(t("core.backup.newer", { version: manifest.schemaVersion ?? "", supported: SCHEMA_VERSION }));
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
 * One table as rows of values, its column names first. Private fields only when asked for: a flight's come from its
 * private row (docs/32, "Private data"). Tombstones are left out.
 */
export function tableRows(store: Store, table: TableName, includePrivate = false): unknown[][] {
  const cols = allColumns(TABLES[table])
    .map((c) => c.name)
    .filter((c) => includePrivate || !PRIVATE_FIELDS.includes(`${table}.${c}`))
    .filter((c) => c !== "deleted" && c !== "basedOn" && c !== "versionVector");
  const rows: unknown[][] = [cols];
  const priv = table === "flights" && includePrivate ? privateIndex(store) : null;
  for (const r of store.all(table)) {
    const row = priv ? { ...r, ...priv.get(r.id) } : r;
    rows.push(cols.map((c) => (row as Record<string, unknown>)[c]));
  }
  return rows;
}

/** One table as CSV (tableRows). */
export function tableCsv(store: Store, table: TableName, includePrivate = false): string {
  return tableRows(store, table, includePrivate).map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
