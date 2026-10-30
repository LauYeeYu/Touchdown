// The sync engine (docs/12-storage-and-sync.md, "Sync algorithm"): pull, merge, push, confirm. It works on rows, so
// it is the same for every backend.
//
// Each row edited on this device waits in a queue, with the version the edits started from, until the storage shows
// it back. When the stored and local versions of a row differ and one was made on top of the other (version vectors),
// that one is kept. Versions made side by side are merged field by field (merge.ts): a new version on top of both,
// with each field edited on both devices kept as the later version has it and the other value listed in
// sync_conflicts for the user to choose on the Issues page. A merge that comes out as the stored version is that
// version: nothing new is made or sent.

import { conflictMatters, rowKey, toUtcIso, ulidFrom, type Change, type Row, type Store, type TableName } from "@touchdown/core";
import { dataFields, mergeRow, sameValue, type FieldConflict } from "./merge.ts";
import type { Backend, Cursor, PullResult, PushItem, StoredRow } from "./types.ts";
import { isBasedOn, isNewer, versionOf } from "./version.ts";

export interface QueuedRow {
  table: TableName;
  key: string;
  /** Stored versions this device's row beat in a conflict, and so may replace. */
  replaces: string[];
  /**
   * The version this device's unsent edits started from, to merge them field by field with another device's; null
   * for a row made here, or when not known (a queue from before this was kept).
   */
  base?: StoredRow | null;
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
  /** Fields edited here and elsewhere since the last sync, listed for the user. */
  conflicts: number;
  /** Files that could not be read. */
  problems: string[];
}

/** How far a round has got, for the app to show. */
export interface SyncProgress {
  /** Tracks read in this round, of those it has to read. */
  tracksDone: number;
  tracksTotal: number;
}

export interface SyncOptions {
  /** Read every table file again, not only the changed ones. */
  full?: boolean;
  /** Called once the tables' rows are merged and saved, before tracks are read. */
  tablesIn?: () => void;
  /**
   * Changes the app makes by itself to rows an older version left (core `settleOlder`): made once the stored rows are
   * merged, so they start from the newest version and merge with other devices' edits like any edit, and sent in this
   * round.
   */
  settle?: () => void;
  progress?: (p: SyncProgress) => void;
}

/** Tracks read at once; a file adapter may send fewer requests at a time. */
const TRACKS_AT_ONCE = 64;
/** Tracks merged between two saves of the position, so a reload goes on from about where it was. */
const TRACKS_PER_SAVE = 16;

const queueKey = (table: TableName, key: string) => `${table}|${key}`;

/** Whether merged values are the stored row's: every column, and whether it is deleted. */
const sameRow = (table: TableName, values: Record<string, unknown>, stored: StoredRow) =>
  dataFields(table).every((f) => sameValue(values[f], stored[f])) && !!values.deleted === !!stored.deleted;
const trackOf = (pointKey: string) => pointKey.slice(0, pointKey.lastIndexOf("|"));

// Tables whose versions made side by side are not merged field by field or listed: history is only ever added to,
// and a sync conflict one device resolved stays resolved. The later version is kept, or the resolved one.
const QUIET = new Set<TableName>(["record_history", "sync_conflicts"]);

interface Found {
  table: TableName;
  key: string;
  conflict: FieldConflict;
  mine: StoredRow;
  theirs: StoredRow;
}

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

  /**
   * Rows and tracks edited on this device that the engine did not see being made (another tab's edits, or edits made
   * before it started): queued as its own edits, a row already queued keeping the version its edits started from.
   */
  enqueue(rows: QueuedRow[], tracks: string[] = []): Promise<void> {
    for (const q of rows) {
      const k = queueKey(q.table, q.key);
      if (!this.queue.has(k)) this.queue.set(k, { table: q.table, key: q.key, replaces: [...q.replaces], base: q.base ?? null });
    }
    for (const t of tracks) this.queuedTracks.add(t);
    return this.save();
  }

  private note(changes: Change[]) {
    let noted = false;
    for (const c of changes) {
      // From the storage, or written by another tab of this browser, which queued its own edits.
      if (c.origin) continue;
      if (c.table === "track_points") {
        this.queuedTracks.add(trackOf(c.id));
        noted = true;
        continue;
      }
      const k = queueKey(c.table, c.id);
      if (this.queue.has(k)) continue;
      this.queue.set(k, { table: c.table, key: c.id, replaces: [], base: (c.before as StoredRow | null) ?? null });
      noted = true;
    }
    if (noted) void this.save();
  }

  private save() {
    return this.state.save({ cursor: this.cursor, queue: [...this.queue.values()], tracks: [...this.queuedTracks] });
  }

  /**
   * One round: pull, merge, push. The tables come first and are saved with the position they were read at; tracks are
   * read after, each saved with its own position, so a round cut short goes on from where it was. `full` reads every
   * table file again, not only the changed ones, so a row edited here whose queue entry was lost is still found and
   * sent.
   */
  async sync(opts: SyncOptions = {}): Promise<SyncReport> {
    while (this.running) await this.running.catch(() => undefined);
    this.running = this.run(opts);
    try {
      return await this.running;
    } finally {
      this.running = null;
    }
  }

  private async run(opts: SyncOptions): Promise<SyncReport> {
    const report: SyncReport = { received: 0, sent: 0, conflicts: 0, problems: [] };
    const from = opts.full ? Object.fromEntries(Object.entries(this.cursor).filter(([path]) => !path.startsWith("tables/"))) : this.cursor;
    const pulled = await this.backend.pull(from);
    report.problems.push(...pulled.problems);

    this.store.batch(() => {
      const found: Found[] = [];
      for (const [table, rows] of pulled.tables) found.push(...this.merge(table, rows, report));
      // After every table is merged, so a conflict the other device listed already is found and not listed twice.
      for (const f of found) this.keepConflict(f);
    });
    for (const [path, version] of Object.entries(pulled.cursor)) if (!path.startsWith("tracks/")) this.cursor[path] = version;
    await this.save();
    opts.settle?.();
    opts.tablesIn?.();

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
      await this.save();
    }

    await this.mergeTracks(pulled, report, opts.progress);
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

  /** Merge one table's stored rows into the local copy. Returns the fields edited on both sides. */
  private merge(table: TableName, stored: StoredRow[], report: SyncReport): Found[] {
    const take: StoredRow[] = [];
    const found: Found[] = [];
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
      const keepMine = () => {
        if (queued) queued.replaces = [...new Set([...queued.replaces, theirVersion])];
        else this.queue.set(k, { table, key, replaces: [theirVersion], base: null });
      };
      const takeTheirs = () => {
        take.push(theirs);
        this.queue.delete(k);
      };
      if (isBasedOn(theirs, mine)) {
        takeTheirs();
        continue;
      }
      // The stored row is older than this one: not sent yet, or the storage lost it to an overwrite.
      if (isBasedOn(mine, theirs) || queued?.replaces.includes(theirVersion)) {
        keepMine();
        continue;
      }
      // Made side by side. What is kept becomes a new version on top of both, unless it is the stored version.
      const mineLater = isNewer(mine, theirs);
      let merged: { values: Record<string, unknown>; conflicts: FieldConflict[] };
      if (QUIET.has(table)) {
        const resolved = table === "sync_conflicts" && !!mine.resolvedAt !== !!theirs.resolvedAt;
        const kept = (resolved ? !!mine.resolvedAt : mineLater) ? mine : theirs;
        merged = { values: Object.fromEntries([...dataFields(table), "deleted"].map((f) => [f, kept[f]])), conflicts: [] };
      } else {
        // The version this device's edits started from is where the two parted only if the stored one was made on
        // top of it. A stale copy written back is not: then every field that differs is listed.
        const base = queued?.base && (versionOf(queued.base) === theirVersion || isBasedOn(theirs, queued.base)) ? queued.base : null;
        merged = mergeRow(table, base, mine, theirs, mineLater);
      }
      report.conflicts += merged.conflicts.length;
      for (const conflict of merged.conflicts) found.push({ table, key, conflict, mine, theirs });
      // Nothing of this device's version is left that the stored one lacks (the same edit made on both, or a value
      // listed and kept as stored): the stored version is taken, and nothing is sent. Its next edit counts on from the
      // stored version, which holds an edit this device's lacked, so it still follows every version it replaces.
      if (sameRow(table, merged.values, theirs)) {
        takeTheirs();
        continue;
      }
      // This device's edits now start from the stored version.
      this.queue.set(k, { table, key, replaces: [...new Set([...(queued?.replaces ?? []), theirVersion])], base: theirs });
      this.store.merged(table, key, merged.values, theirs);
    }
    // Rows only here: queued ones are sent anyway; any other went missing from the storage and is sent again.
    for (const mine of this.store.allWithDeleted(table)) {
      const key = rowKey(table, mine as unknown as StoredRow);
      const k = queueKey(table, key);
      if (!seen.has(key) && !this.queue.has(k)) this.queue.set(k, { table, key, replaces: [], base: null });
    }
    if (take.length) {
      this.store.applyRemote(table, take as unknown as Row<TableName>[]);
      report.received += take.length;
    }
    return found;
  }

  /**
   * List a field edited on both sides once: both devices may find the same conflict, and they make the same id for
   * it from the two versions.
   */
  private keepConflict({ table, key, conflict, mine, theirs }: Found) {
    // Values the app works out again, and its own bookkeeping, are not the user's to settle (core conflicts.ts).
    if (!conflictMatters(this.store, table, key, conflict.field)) return;
    const [kept, other] = conflict.keptMine ? [mine, theirs] : [theirs, mine];
    const versions = [versionOf(mine), versionOf(theirs)].sort();
    const at = Math.max(Date.parse(String(mine.updatedAt)) || 0, Date.parse(String(theirs.updatedAt)) || 0) || this.now();
    const id = ulidFrom(at, `${table}|${key}|${conflict.field}|${versions.join("|")}`);
    if (this.store.peek("sync_conflicts", id)) return;
    this.store.insert(
      "sync_conflicts",
      {
        tableName: table,
        recordId: key,
        field: conflict.field,
        keptValue: JSON.stringify(conflict.kept ?? null),
        otherValue: JSON.stringify(conflict.other ?? null),
        keptBy: String(kept.updatedBy),
        keptAt: String(kept.updatedAt),
        otherBy: String(other.updatedBy),
        otherAt: String(other.updatedAt),
        detectedAt: toUtcIso(this.now()),
      },
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

  /**
   * Read the tracks changed in the storage, and those it has that this device has no points for (a copy lost before it
   * was saved), many at once. The tracks that arrive together are merged together, once the reads give way, so the app
   * hears one change for them rather than one each. Each keeps its position as it is merged, saved every few, so a round
   * cut short reads only the rest. A track that could not be read keeps its old position and is read again next time.
   */
  private async mergeTracks(pulled: PullResult, report: SyncReport, progress?: (p: SyncProgress) => void) {
    const local = this.pointsByTrack();
    const there = new Set(pulled.tracks);
    const wanted = new Set(pulled.changedTracks);
    for (const id of pulled.tracks) if (!local.has(id)) wanted.add(id);
    // Points changed here and not written yet win: a track is replaced as a whole.
    const ids = [...wanted].filter((id) => !this.queuedTracks.has(id));
    let done = 0;
    let unsaved = 0;
    progress?.({ tracksDone: 0, tracksTotal: ids.length });
    const arrived: { trackId: string; points: StoredRow[] | null }[] = [];
    const merge = async () => {
      const list = arrived.splice(0);
      if (!list.length) return;
      this.store.batch(() => {
        for (const { trackId, points } of list) {
          if (!points || this.queuedTracks.has(trackId)) continue;
          this.store.purge("track_points", (local.get(trackId) ?? []).map((p) => rowKey("track_points", p)), "sync");
          if (points.length) this.store.putRaw("track_points", points as unknown as Row<"track_points">[], "sync");
          if (points.length) local.set(trackId, points);
          else local.delete(trackId);
          report.received += points.length;
          const path = `tracks/${trackId}.json`;
          const version = pulled.cursor[path];
          if (version === undefined) delete this.cursor[path];
          else this.cursor[path] = version;
          unsaved++;
        }
      });
      done += list.length;
      progress?.({ tracksDone: done, tracksTotal: ids.length });
      if (unsaved >= TRACKS_PER_SAVE) {
        unsaved = 0;
        await this.save();
      }
    };
    let merging: Promise<void> = Promise.resolve();
    let waiting = false;
    const soon = () => {
      if (waiting) return;
      waiting = true;
      merging = merging.then(() => new Promise<void>((r) => setTimeout(r, 0))).then(() => {
        waiting = false;
        return merge();
      });
    };
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const trackId = ids[next++]!;
        let points: StoredRow[] | null = null;
        try {
          points = await this.backend.readTrack(trackId);
        } catch (e) {
          report.problems.push(`tracks/${trackId}.json: ${(e as Error).message}`);
        }
        arrived.push({ trackId, points });
        soon();
      }
    };
    await Promise.all(Array.from({ length: Math.min(TRACKS_AT_ONCE, ids.length) }, worker));
    await merging;
    await merge();
    if (unsaved) await this.save();
    // Tracks only here went missing from the storage (or were never sent): send them.
    for (const trackId of local.keys()) if (!there.has(trackId)) this.queuedTracks.add(trackId);
  }
}
