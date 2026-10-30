// The storage interface (docs/12-storage-and-sync.md, "Backend interface"). Every backend implements it, so sync,
// the CLI's inbox and the agent check hand-off work the same whatever the user's storage is (S7).

import type { TableName } from "@touchdown/core";

/** A stored row: the schema's columns, system columns included (docs/10, "System columns"). */
export type StoredRow = Record<string, unknown>;

/** Files kept with the log. */
export type FileArea = "inbox" | "checks" | "attachments";

export interface FileInfo {
  /** The name within its folder. */
  name: string;
  /** Changes whenever the content changes (Drive's file version, a local file's time and size). */
  version: string;
}

/** Where a file backend keeps its files. Paths are relative to the Touchdown folder, with "/" between parts. */
export interface FileAdapter {
  /** Files directly in a folder; an empty list when the folder does not exist. */
  list(dir: string): Promise<FileInfo[]>;
  read(path: string): Promise<{ data: Uint8Array; version: string } | null>;
  write(path: string, data: Uint8Array): Promise<{ version: string }>;
  remove(path: string): Promise<void>;
}

/** The version of each data file at the last pull, by path. */
export type Cursor = Record<string, string>;

export interface PullResult {
  /** Every row of each table whose file changed since the cursor. Tables not listed did not change. */
  tables: Map<TableName, StoredRow[]>;
  /** Tracks whose points changed (or went) since the cursor. */
  changedTracks: string[];
  /** Every track that has points in the storage. */
  tracks: string[];
  /** Files that are not valid Touchdown data. They are left out, and read again next time (docs/12). */
  problems: string[];
  cursor: Cursor;
}

/** A row to write. Besides versions it is based on, it may replace the stored versions it beat in a conflict. */
export interface PushItem {
  table: TableName;
  row: StoredRow;
  replaces: string[];
}

export interface PushResult {
  /** Keys of the rows written. */
  written: string[];
  /** Keys of the rows found in the storage already, exactly as sent. */
  present: string[];
  /** Keys not written because the stored row changed meanwhile: the next pull merges them. */
  conflicts: string[];
}

export interface Backend {
  readonly id: "json_tables" | "sqlite_file";
  readonly kind: "file" | "server";
  /** Create the storage when it is empty, and report the stored schema version. */
  open(): Promise<{ schemaVersion: number; created: boolean }>;
  pull(cursor: Cursor): Promise<PullResult>;
  push(items: PushItem[]): Promise<PushResult>;
  readTrack(trackId: string): Promise<StoredRow[]>;
  /** Replace a track's points; none removes them. */
  writeTrack(trackId: string, points: StoredRow[]): Promise<void>;
  listFiles(area: FileArea): Promise<FileInfo[]>;
  readFile(area: FileArea, name: string): Promise<Uint8Array | null>;
  writeFile(area: FileArea, name: string, data: Uint8Array): Promise<void>;
  removeFile(area: FileArea, name: string): Promise<void>;
}
