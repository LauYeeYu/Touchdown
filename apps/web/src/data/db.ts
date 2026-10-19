// IndexedDB through Dexie: the browser's full local copy of the user's data (docs/12-storage-and-sync.md).
// One object store holds every schema row, keyed by table and id, so the layout follows the schema
// without a migration per table.

import Dexie, { type Table } from "dexie";

export interface StoredRow {
  table: string;
  id: string;
  row: Record<string, unknown>;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

class TouchdownDb extends Dexie {
  rows!: Table<StoredRow, [string, string]>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super("touchdown");
    this.version(1).stores({ rows: "[table+id], table", meta: "key" });
  }
}

export const db = new TouchdownDb();
