// The sync engine (docs/12-storage-and-sync.md, "Sync algorithm"): pull, merge per row, push, confirm. It works on
// rows, so it is the same for every backend.
//
// Each row edited on this device waits in a queue until the storage shows it back. When the stored and local
// versions of a row differ, one was edited on top of the other (`basedOn`, or one device's versions following each
// other) and the later one is kept; otherwise they were edited side by side, the later edit wins, and the other is
// kept in record_history as a sync conflict for the user to review.

import { rowKey, toUtcIso, ulidFrom, type Change, type Row, type Store, type TableName } from "@touchdown/core";
import type { Backend, Cursor, PushItem, StoredRow } from "./types.ts";
import { isBasedOn, isNewer, versionOf } from "./version.ts";

export interface QueuedRow {
  table: TableName;
  key: string;
  /** Stored versions this device's row beat in a conflict, and so may replace. */
  replaces: string[];
}

export interface SyncState {
  cursor: Cursor;
  queue: QueuedRow[];
  /** Tracks whose points were changed on this device and not written yet. */
  tracks: string[];
}

/** Where the engine keeps its state between runs (IndexedDB in the browser, memory in tests). */
export interface SyncStateStore {
  load(): Promise<SyncState | null>;
  save(state: SyncState): Promise<void>;
}

export class MemorySyncState implements SyncStateStore {
  state: SyncState | null = null;
  async load() {
    return this.state && structuredClone(this.state);
  }
  async save(state: SyncState) {
    this.state = structuredClone(state);
  }
}

export interface SyncReport {
  /** Rows and track points taken from the storage. */
  received: number;
  /** Rows written to the storage (or found there already). */
  sent: number;
  /** Rows edited here and elsewhere since the last sync. */
  conflicts: number;
  /** Files that could not be read. */
  problems: string[];
}

const queueKey = (table: TableName, key: string) => `${table}|${key}`;
const trackOf = (pointKey: string) => pointKey.slice(0, pointKey.lastIndexOf("|"));

export class SyncEngine {
  private queue = new Map<string, QueuedRow>();
  private queuedTracks = new Set<string>();
  private cursor: Cursor = {};
  private running: Promise<SyncReport> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly store: Store,
    private readonly backend: Backend,
    private readonly state: SyncStateStore,
    private readonly now: () => number = Date.now,
  ) {}

  /** Load the saved state and start noting edits made on this device. */
  async start() {
    const saved = await this.state.load();
    if (saved) {
      this.cursor = saved.cursor;
      for (const q of saved.queue) this.queue.set(queueKey(q.table, q.key), q);
      for (const t of saved.tracks) this.queuedTracks.add(t);
    }
    this.unsubscribe = this.store.subscribe((changes) => this.note(changes));
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Rows and tracks changed on this device that the storage has not shown back yet. */
  get waiting(): number {
    return this.queue.size + this.queuedTracks.size;
  }

  private note(changes: Change[]) {
    let noted = false;
    for (const c of changes) {
      if (c.origin === "sync") continue;
      if (c.table === "track_points") {
        this.queuedTracks.add(trackOf(c.id));
        noted = true;
        continue;
      }
      const k = queueKey(c.table, c.id);
      if (this.queue.has(k)) continue;
      this.queue.set(k, { table: c.table, key: c.id, replaces: [] });
      noted = true;
    }
    if (noted) void this.save();
  }

  private save() {
    return this.state.save({ cursor: this.cursor, queue: [...this.queue.values()], tracks: [...this.queuedTracks] });
  }

  /**
   * One round: pull, merge, push. `full` reads every table file again, not only the changed ones, so a row edited
   * here whose queue entry was lost (the browser closed before it was saved) is still found and sent.
   */
  async sync(opts: { full?: boolean } = {}): Promise<SyncReport> {
    while (this.running) await this.running.catch(() => undefined);
    this.running = this.run(opts.full ?? false);
    try {
      return await this.running;
    } finally {
      this.running = null;
    }
  }

  private async run(full: boolean): Promise<SyncReport> {
    const report: SyncReport = { received: 0, sent: 0, conflicts: 0, problems: [] };
    const from = full ? Object.fromEntries(Object.entries(this.cursor).filter(([path]) => !path.startsWith("tables/"))) : this.cursor;
    const pulled = await this.backend.pull(from);
    report.problems.push(...pulled.problems);

    this.store.batch(() => {
      const losers: { table: TableName; key: string; row: StoredRow }[] = [];
      for (const [table, rows] of pulled.tables) losers.push(...this.merge(table, rows, report));
      // After every table is merged, so a conflict the other device kept already is found and not kept twice.
      for (const l of losers) this.keepLoser(l.table, l.key, l.row);
    });
    await this.mergeTracks(pulled.changedTracks, pulled.tracks, report);
    this.cursor = pulled.cursor;
    await this.save();

    const items: PushItem[] = [];
    for (const q of this.queue.values()) {
      const row = this.store.peek(q.table, q.key) as StoredRow | null;
      if (row) items.push({ table: q.table, row, replaces: q.replaces });
    }
    if (items.length) {
      const pushed = await this.backend.push(items);
      report.sent = pushed.written.length;
      const written = new Set(pushed.written);
      const present = new Set(pushed.present);
      for (const item of items) {
        const k = queueKey(item.table, rowKey(item.table, item.row));
        const q = this.queue.get(k);
        if (!q) continue;
        // Found in the storage exactly as it is here: confirmed.
        if (present.has(q.key)) this.queue.delete(k);
        // Written rows wait for a later pull: another device may overwrite the file meanwhile.
      }
    }
    const points = this.queuedTracks.size ? this.pointsByTrack() : new Map<string, StoredRow[]>();
    for (const trackId of [...this.queuedTracks]) {
      const list = points.get(trackId) ?? [];
      await this.backend.writeTrack(trackId, list);
      this.queuedTracks.delete(trackId);
      report.sent += list.length;
    }
    await this.save();
    return report;
  }

  /** Merge one table's stored rows into the local copy. Returns the versions that lost a conflict. */
  private merge(table: TableName, stored: StoredRow[], report: SyncReport) {
    const take: StoredRow[] = [];
    const losers: { table: TableName; key: string; row: StoredRow }[] = [];
    const seen = new Set<string>();
    for (const theirs of stored) {
      const key = rowKey(table, theirs);
      seen.add(key);
      const k = queueKey(table, key);
      const mine = this.store.peek(table, key) as StoredRow | null;
      const queued = this.queue.get(k);
      if (!mine) {
        take.push(theirs);
        continue;
      }
      const theirVersion = versionOf(theirs);
      if (versionOf(mine) === theirVersion) {
        this.queue.delete(k);
        continue;
      }
      let mineWins: boolean;
      if (isBasedOn(theirs, mine)) mineWins = false;
      // The stored row is older than this one: not sent yet, or the storage lost it to an overwrite.
      else if (isBasedOn(mine, theirs) || queued?.replaces.includes(theirVersion)) mineWins = true;
      else {
        mineWins = isNewer(mine, theirs);
        // History rows are never edited, only made twice (a conflict kept on both devices): nothing to keep.
        if (table !== "record_history") {
          report.conflicts++;
          losers.push({ table, key, row: mineWins ? theirs : mine });
        }
      }
      if (mineWins) {
        if (queued) queued.replaces = [...new Set([...queued.replaces, theirVersion])];
        else this.queue.set(k, { table, key, replaces: [theirVersion] });
      } else {
        take.push(theirs);
        this.queue.delete(k);
      }
    }
    // Rows only here: queued ones are sent anyway; any other went missing from the storage and is sent again.
    for (const mine of this.store.allWithDeleted(table)) {
      const key = rowKey(table, mine as unknown as StoredRow);
      const k = queueKey(table, key);
      if (!seen.has(key) && !this.queue.has(k)) this.queue.set(k, { table, key, replaces: [] });
    }
    if (take.length) {
      this.store.applyRemote(table, take as unknown as Row<TableName>[]);
      report.received += take.length;
    }
    return losers;
  }

  /** Keep the losing version once: both devices may notice the same conflict, and they make the same id for it. */
  private keepLoser(table: TableName, key: string, loser: StoredRow) {
    const id = ulidFrom(Date.parse(String(loser.updatedAt)) || this.now(), `${table}|${key}|${versionOf(loser)}`);
    if (this.store.peek("record_history", id)) return;
    this.store.insert(
      "record_history",
      { tableName: table, recordId: key, recordRev: Number(loser.rev), row: loser, changedAt: toUtcIso(this.now()), reason: "sync_conflict" },
      id,
    );
  }

  private pointsByTrack(): Map<string, StoredRow[]> {
    const out = new Map<string, StoredRow[]>();
    for (const p of this.store.allWithDeleted("track_points") as unknown as StoredRow[]) {
      const id = String(p.trackId);
      const list = out.get(id);
      if (list) list.push(p);
      else out.set(id, [p]);
    }
    return out;
  }

  private async mergeTracks(changed: string[], present: string[], report: SyncReport) {
    const local = this.pointsByTrack();
    for (const trackId of changed) {
      // Points changed here and not written yet win: a track is replaced as a whole.
      if (this.queuedTracks.has(trackId)) continue;
      let points: StoredRow[];
      try {
        points = await this.backend.readTrack(trackId);
      } catch (e) {
        report.problems.push(`tracks/${trackId}.json: ${(e as Error).message}`);
        continue;
      }
      this.store.batch(() => {
        this.store.purge("track_points", (local.get(trackId) ?? []).map((p) => rowKey("track_points", p)), "sync");
        if (points.length) this.store.putRaw("track_points", points as unknown as Row<"track_points">[], "sync");
      });
      if (points.length) local.set(trackId, points);
      else local.delete(trackId);
      report.received += points.length;
    }
    // Tracks only here went missing from the storage (or were never sent): send them.
    const there = new Set(present);
    for (const trackId of local.keys()) if (!there.has(trackId)) this.queuedTracks.add(trackId);
  }
}
