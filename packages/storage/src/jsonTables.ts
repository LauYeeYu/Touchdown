// The JSON tables file backend (docs/12-storage-and-sync.md, "File backend: JSON tables"), over any file adapter:
// a manifest, one file per table, one file per track's points, and the file areas as folders.

import {
  allColumns,
  checkTableFile,
  FILE_TABLES,
  rowKey,
  SCHEMA_NAME,
  SCHEMA_VERSION,
  stringifyTableFile,
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
    super(`The log uses schema version ${stored}; this version of Touchdown understands up to ${SCHEMA_VERSION}. Reload to update the app.`);
  }
}

export const tablePath = (t: TableName) => `tables/${t}.json`;
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
  if (typeof file.schemaVersion === "number" && file.schemaVersion > SCHEMA_VERSION) {
    return { problems: [`written with schema version ${file.schemaVersion}, newer than this app's ${SCHEMA_VERSION}`] };
  }
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
    // tells an older app on another device to update first.
    if (version < SCHEMA_VERSION) {
      await this.files.write("manifest.json", encoder.encode(JSON.stringify({ ...manifest, schemaVersion: SCHEMA_VERSION, lastWriter: this.deviceId }, null, 2) + "\n"));
    }
    return { schemaVersion: version, created: false };
  }

  async pull(cursor: Cursor): Promise<PullResult> {
    const next: Cursor = { ...cursor };
    const out: PullResult = { tables: new Map(), changedTracks: [], tracks: [], problems: [], cursor: next };

    const listed = new Map((await this.files.list("tables")).map((f) => [`tables/${f.name}`, f.version]));
    for (const t of FILE_TABLES) {
      const path = tablePath(t);
      const version = listed.get(path);
      // A table with no file yet reads as empty once, so the rows this device has for it get sent.
      if (version === undefined) {
        if (cursor[path] !== ABSENT) out.tables.set(t, []);
        next[path] = ABSENT;
        continue;
      }
      if (cursor[path] === version) continue;
      const file = await this.files.read(path);
      if (!file) continue;
      const parsed = parseTable(file.data, t);
      if ("problems" in parsed) {
        out.problems.push(...parsed.problems.slice(0, 5).map((p) => `${path}: ${p}`));
        continue;
      }
      out.tables.set(t, parsed.rows);
      next[path] = file.version;
    }

    const present = new Set<string>();
    for (const f of await this.files.list("tracks")) {
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
    if ("problems" in parsed) throw new Error(parsed.problems.slice(0, 3).join("; "));
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
