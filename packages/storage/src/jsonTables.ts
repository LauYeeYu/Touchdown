// The JSON tables file backend (docs/12-storage-and-sync.md, "File backend: JSON tables"), over any file adapter:
// a manifest, one file per table (tables whose rows can hold private data in private/, the others in tables/), one
// file per track's points, and the file areas as folders.

import {
  allColumns,
  checkTableFile,
  FILE_TABLES,
  isPrivateTable,
  rowKey,
  SCHEMA_NAME,
  SCHEMA_VERSION,
  stringifyTableFile,
  tableFilePath,
  TABLES,
  upgradeTableFile,
  type Manifest,
  type TableFile,
  type TableName,
} from "@touchdown/core";
import type { Backend, Cursor, FileAdapter, FileArea, PullResult, PushItem, PushResult, StoredRow } from "./types.ts";
import { isBasedOn, versionOf } from "./version.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class SchemaTooNewError extends Error {
  constructor(readonly stored: number) {
    super(`The log uses schema version ${stored}, and this version of Touchdown understands only up to ${SCHEMA_VERSION}. Reload to update the app.`);
  }
}

export const tablePath = tableFilePath;
const ABSENT = "";
const trackPath = (trackId: string) => `tracks/${trackId}.json`;

function checkTrackId(trackId: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(trackId)) throw new Error(`Not a track id: ${trackId}`);
}

/** A file name inside an area; sub-folders are allowed, leaving the area is not. */
function checkName(name: string) {
  if (!name || name.startsWith("/") || name.includes("\\") || name.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Not a file name: ${name}`);
  }
}

function tableFile(table: TableName, rows: StoredRow[]): TableFile {
  const columns = allColumns(TABLES[table]).map((c) => c.name);
  return {
    schema: SCHEMA_NAME,
    schemaVersion: SCHEMA_VERSION,
    table,
    columns,
    rows: rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null]))),
  };
}

/** The rows of a table file, or what is wrong with it. */
function parseTable(data: Uint8Array, table: TableName): { rows: StoredRow[] } | { problems: string[] } {
  let file: TableFile;
  try {
    file = JSON.parse(decoder.decode(data)) as TableFile;
  } catch {
    return { problems: ["not valid JSON"] };
  }
  // A newer version of the app has changed the log since this one opened it: stop until this app is updated, and
  // never write over the file.
  if (typeof file.schemaVersion === "number" && file.schemaVersion > SCHEMA_VERSION) throw new SchemaTooNewError(file.schemaVersion);
  file = upgradeTableFile(file, table);
  const problems = checkTableFile(file, table);
  return problems.length ? { problems: problems.map((p) => p.message) } : { rows: file.rows };
}

export class JsonTablesBackend implements Backend {
  readonly id = "json_tables";
  readonly kind = "file";

  constructor(
    private readonly files: FileAdapter,
    private readonly deviceId: string,
  ) {}

  async open() {
    const found = await this.files.read("manifest.json");
    if (!found) {
      const manifest: Manifest = {
        schema: SCHEMA_NAME,
        schemaVersion: SCHEMA_VERSION,
        backend: "json_tables",
        tables: Object.fromEntries(FILE_TABLES.map((t) => [t, tablePath(t)])),
        lastWriter: this.deviceId,
      };
      await this.files.write("manifest.json", encoder.encode(JSON.stringify(manifest, null, 2) + "\n"));
      return { schemaVersion: SCHEMA_VERSION, created: true };
    }
    let manifest: Partial<Manifest>;
    try {
      manifest = JSON.parse(decoder.decode(found.data)) as Partial<Manifest>;
    } catch {
      throw new Error("manifest.json is not valid JSON.");
    }
    if (manifest.schema !== SCHEMA_NAME || manifest.backend !== "json_tables") throw new Error("This folder does not hold a Touchdown log in JSON tables.");
    const version = Number(manifest.schemaVersion);
    if (version > SCHEMA_VERSION) throw new SchemaTooNewError(version);
    // Older table files are upgraded as they are read and written in the new version from then on; the manifest
    // tells an older app on another device to update first. Files of tables the schema no longer has are left
    // where they are and not read.
    if (version < SCHEMA_VERSION) {
      const tables = Object.fromEntries(FILE_TABLES.map((t) => [t, tablePath(t)]));
      await this.files.write("manifest.json", encoder.encode(JSON.stringify({ ...manifest, schemaVersion: SCHEMA_VERSION, tables, lastWriter: this.deviceId }, null, 2) + "\n"));
    }
    await this.movePrivateFiles();
    return { schemaVersion: version, created: false };
  }

  /**
   * Private tables still in tables/ (written before version 7) move to private/ (docs/12, "Schema migrations"): their
   * rows go into the file there as a push writes them, so a newer row there is never replaced, and only then is the
   * old file removed. A device that stops half way finds the old file next time and finishes. An unreadable old file
   * is left where it is.
   */
  private async movePrivateFiles() {
    const listed = new Set((await this.files.list("tables")).map((f) => f.name));
    for (const t of FILE_TABLES.filter(isPrivateTable)) {
      const old = `tables/${t}.json`;
      if (!listed.has(`${t}.json`)) continue;
      const file = await this.files.read(old);
      if (file) {
        const parsed = parseTable(file.data, t);
        if ("problems" in parsed) continue;
        // An unreadable file in private/ is never written over, so the old one stays too.
        const target = await this.files.read(tablePath(t));
        if (target && "problems" in parseTable(target.data, t)) continue;
        // A row the file in private/ has in another version keeps that version: it was made since.
        await this.push(parsed.rows.map((row) => ({ table: t, row, replaces: [] })));
      }
      await this.files.remove(old);
    }
  }

  async pull(cursor: Cursor): Promise<PullResult> {
    const next: Cursor = { ...cursor };
    const out: PullResult = { tables: new Map(), changedTracks: [], tracks: [], problems: [], cursor: next };

    // The folders are listed, and every changed table file read, at the same time.
    const [tableFiles, privateFiles, trackFiles] = await Promise.all([this.files.list("tables"), this.files.list("private"), this.files.list("tracks")]);
    const listed = new Map<string, string>([...tableFiles.map((f) => [`tables/${f.name}`, f.version] as const), ...privateFiles.map((f) => [`private/${f.name}`, f.version] as const)]);
    const read = await Promise.all(
      FILE_TABLES.map(async (t): Promise<StoredRow[] | null> => {
        const path = tablePath(t);
        const version = listed.get(path);
        // A table with no file yet reads as empty once, so the rows this device has for it get sent.
        if (version === undefined) {
          next[path] = ABSENT;
          return cursor[path] !== ABSENT ? [] : null;
        }
        if (cursor[path] === version) return null;
        const file = await this.files.read(path);
        if (!file) return null;
        const parsed = parseTable(file.data, t);
        if ("problems" in parsed) {
          out.problems.push(...parsed.problems.slice(0, 5).map((p) => `${path}: ${p}`));
          return null;
        }
        next[path] = file.version;
        return parsed.rows;
      }),
    );
    FILE_TABLES.forEach((t, i) => read[i] && out.tables.set(t, read[i]));

    const present = new Set<string>();
    for (const f of trackFiles) {
      if (!f.name.endsWith(".json")) continue;
      const path = `tracks/${f.name}`;
      const id = f.name.slice(0, -".json".length);
      present.add(path);
      out.tracks.push(id);
      if (cursor[path] !== f.version) {
        out.changedTracks.push(id);
        next[path] = f.version;
      }
    }
    for (const path of Object.keys(cursor)) {
      if (!path.startsWith("tracks/") || present.has(path)) continue;
      out.changedTracks.push(path.slice("tracks/".length, -".json".length));
      delete next[path];
    }
    return out;
  }

  async push(items: PushItem[]): Promise<PushResult> {
    const result: PushResult = { written: [], present: [], conflicts: [] };
    const byTable = new Map<TableName, PushItem[]>();
    for (const item of items) byTable.set(item.table, [...(byTable.get(item.table) ?? []), item]);

    for (const [table, list] of byTable) {
      const path = tablePath(table);
      const rows = new Map<string, StoredRow>();
      const file = await this.files.read(path);
      if (file) {
        const parsed = parseTable(file.data, table);
        // An invalid file is never overwritten: it may hold edits made elsewhere (docs/12).
        if ("problems" in parsed) {
          result.conflicts.push(...list.map((i) => rowKey(table, i.row)));
          continue;
        }
        for (const r of parsed.rows) rows.set(rowKey(table, r), r);
      }
      let changed = false;
      for (const item of list) {
        const key = rowKey(table, item.row);
        const stored = rows.get(key);
        const mine = versionOf(item.row);
        if (stored && versionOf(stored) === mine) {
          result.present.push(key);
        } else if (!stored || isBasedOn(item.row, stored) || item.replaces.includes(versionOf(stored))) {
          rows.set(key, item.row);
          changed = true;
          result.written.push(key);
        } else {
          result.conflicts.push(key);
        }
      }
      if (changed) await this.files.write(path, encoder.encode(stringifyTableFile(tableFile(table, [...rows.values()]))));
    }
    return result;
  }

  async readTrack(trackId: string): Promise<StoredRow[]> {
    checkTrackId(trackId);
    const file = await this.files.read(trackPath(trackId));
    if (!file) return [];
    const parsed = parseTable(file.data, "track_points");
    if ("problems" in parsed) throw new Error(parsed.problems.slice(0, 3).join(", "));
    return parsed.rows;
  }

  async writeTrack(trackId: string, points: StoredRow[]) {
    checkTrackId(trackId);
    if (!points.length) await this.files.remove(trackPath(trackId));
    else await this.files.write(trackPath(trackId), encoder.encode(stringifyTableFile(tableFile("track_points", points))));
  }

  listFiles(area: FileArea) {
    return this.files.list(area);
  }

  async readFile(area: FileArea, name: string) {
    checkName(name);
    return (await this.files.read(`${area}/${name}`))?.data ?? null;
  }

  async writeFile(area: FileArea, name: string, data: Uint8Array) {
    checkName(name);
    await this.files.write(`${area}/${name}`, data);
  }

  async removeFile(area: FileArea, name: string) {
    checkName(name);
    await this.files.remove(`${area}/${name}`);
  }
}
