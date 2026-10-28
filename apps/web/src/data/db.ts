// IndexedDB through Dexie: the browser's full local copy of the user's data (docs/12-storage-and-sync.md).
// One object store holds every schema row, keyed by table and id, so the layout follows the schema
// without a migration per table. Track points are the exception: one record per track (trackPoints.ts).

import Dexie, { type Table } from "dexie";
import { assertSameRows, groupTrackPoints, hasTrackKey, type TrackPointsRecord } from "./trackPoints.ts";

export interface StoredRow {
  table: string;
  id: string;
  row: Record<string, unknown>;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

/**
 * An edit made in a tab that does not write the browser's copy itself (tabs.ts), or made before sync started, kept
 * until the tab that writes the copy has taken it into its rows and its sync queue.
 */
export interface OutboxRecord {
  /** "<table>|<row key>", or "track|<track id>" for a track's points. */
  key: string;
  table: string;
  id: string;
  /** A row: as it was before the first edit not taken yet, and as it is now. */
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** A track: its points now; none when it was removed. */
  points?: Record<string, unknown>[];
  /** New with every write of the record, so the writing tab removes only the version it took. */
  stamp: string;
}

class TouchdownDb extends Dexie {
  rows!: Table<StoredRow, [string, string]>;
  trackPoints!: Table<TrackPointsRecord, string>;
  meta!: Table<MetaRow, string>;
  outbox!: Table<OutboxRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ rows: "[table+id], table", meta: "key" });
    // Version 2 moves track points from one record per point to one per track. The move runs inside the
    // upgrade's own transaction and is checked against the original rows before they are removed: if the copy
    // differs in any way, the upgrade fails as a whole and the browser keeps version 1 exactly as it was.
    this.version(2)
      .stores({ rows: "[table+id], table", trackPoints: "trackId", meta: "key" })
      .upgrade(async (tx) => {
        const old = (await tx.table<StoredRow>("rows").where("table").equals("track_points").toArray()).filter((r) => hasTrackKey(r.row));
        const rows = old.map((r) => r.row);
        await tx.table("trackPoints").bulkPut(groupTrackPoints(rows));
        assertSameRows(rows, await tx.table<TrackPointsRecord>("trackPoints").toArray());
        await tx.table("rows").bulkDelete(old.map((r) => [r.table, r.id]));
      });
    // Version 3 adds the edits other tabs hand to the tab that writes the copy.
    this.version(3).stores({ rows: "[table+id], table", trackPoints: "trackId", meta: "key", outbox: "key" });
    // Another tab upgraded the database or deleted it (signing out): this page's copy is out of date.
    this.on("versionchange", () => {
      this.close();
      location.reload();
      return false;
    });
  }
}

/**
 * The browser's copy of one account's log. Each account has its own database (docs/33), so people who share a
 * browser never see each other's logs. Signed out in development, and before accounts existed, it is "touchdown".
 */
export let db = new TouchdownDb("touchdown");

/** Use this account's database. Called once, before anything is read. */
export function openAccountDb(accountId: string | null): void {
  const name = accountId ? `touchdown-${accountId}` : "touchdown";
  if (db.name === name) return;
  db.close();
  db = new TouchdownDb(name);
}
