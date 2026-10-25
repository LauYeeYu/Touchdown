// The sync engine (docs/12-storage-and-sync.md, "Sync algorithm"): pull, merge, push, confirm. It works on rows, so
// it is the same for every backend.
//
// Each row edited on this device waits in a queue, with the version the edits started from, until the storage shows
// it back. When the stored and local versions of a row differ and one was made on top of the other (version vectors),
// that one is kept. Versions made side by side are merged field by field (merge.ts): a new version on top of both,
// with each field edited on both devices kept as the later version has it and the other value listed in
// sync_conflicts for the user to choose on the Issues page.

import { rowKey, toUtcIso, ulidFrom, type Change, type Row, type Store, type TableName } from "@touchdown/core";
import { dataFields, mergeRow, type FieldConflict } from "./merge.ts";
import type { Backend, Cursor, PushItem, StoredRow } from "./types.ts";
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

const queueKey = (table: TableName, key: string) => `${table}|${key}`;
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
      this.queue.set(k, { table: c.table, key: c.id, replaces: [], base: (c.before as StoredRow | null) ?? null });
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
      const found: Found[] = [];
      for (const [table, rows] of pulled.tables) found.push(...this.merge(table, rows, report));
      // After every table is merged, so a conflict the other device listed already is found and not listed twice.
      for (const f of found) this.keepConflict(f);
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
      // Made side by side. What is kept becomes a new version on top of both, even when the two hold the same values,
      // so each device's versions of a row follow one another and its next edit counts on from its last.
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
      // This device's edits now start from the stored version.
      this.queue.set(k, { table, key, replaces: [...new Set([...(queued?.replaces ?? []), theirVersion])], base: theirs });
      this.store.merged(table, key, merged.values, theirs);
      report.conflicts += merged.conflicts.length;
      for (const conflict of merged.conflicts) found.push({ table, key, conflict, mine, theirs });
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
