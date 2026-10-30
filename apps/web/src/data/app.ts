// The app's data: the core row store, kept in memory and persisted to IndexedDB, plus the reference
// index and everything derived from them (findings, airframe links). The UI reads and writes only here.

import {
  acceptFinding,
  applyChanges,
  applyFix,
  checkAll,
  commitImport,
  deleteRecord,
  mergeAirframes,
  conflictsToShow,
  phasesOf,
  setPhases,
  settlePhases,
  settlePrivate,
  reconcile,
  resolveConflict,
  operatorFromOverride,
  RefIndex,
  reopenFinding,
  resolveAirframes,
  rowKey,
  rowVersion,
  saveFlight,
  saveSighting,
  saveSightings,
  setFamily,
  saveView,
  removeView,
  type SavedView,
  settingsOf,
  Store,
  TABLES,
  tagsOf,
  ulid,
  undoImport,
  updateAirframe,
  updateSettings,
  type AppliedChanges,
  type ChangeStatus,
  type CommitDecision,
  type InboxChange,
  type Finding,
  type FlightValues,
  type Match,
  type ParsedSource,
  type RefTables,
  type ResolveResult,
  type Row,
  type Settings,
  type SightingValues,
  type SuggestedFix,
  type TableName,
} from "@touchdown/core";
import { isBasedOn, isNewer, mergeRow, type QueuedRow, type StoredRow as SyncRow, type SyncState } from "@touchdown/storage";
import { CONNECTION, LAST_BACKUP, LAST_CHANGE, setMeta, type Connection } from "./connection.ts";
import { db, type OutboxRecord } from "./db.ts";
import { forgetGoogleToken } from "./google.ts";
import { hasTables, savedSyncState, SYNC_CHECKED, SyncController, TabSync, type SyncHandle, type SyncInfo } from "./sync.ts";
import type { SavedRow, TabMessage, Tabs } from "./tabs.ts";
import { groupTrackPoints, hasTrackKey } from "./trackPoints.ts";

function deviceId(): string {
  try {
    let id = localStorage.getItem("td-device");
    if (!id) {
      id = `dev_${ulid().slice(-10).toLowerCase()}`;
      localStorage.setItem("td-device", id);
    }
    return id;
  } catch {
    return `dev_${ulid().slice(-10).toLowerCase()}`;
  }
}

/**
 * This browser becomes a new device for sync. After its copy is replaced (a backup restored), its rows no longer
 * include every version it made, and its next edits must not count on from those (version vectors, docs/12).
 */
function renewDeviceId() {
  try {
    localStorage.setItem("td-device", `dev_${ulid().slice(-10).toLowerCase()}`);
  } catch {
    // A new id is made on the next visit anyway when storage is unavailable.
  }
}

export type SaveState = "saved" | "saving" | "error";

/** Steps of opening the log, for the loading bar: reference data and the log are read at the same time. */
export type OpenStep = "reference" | "log";

// Let the loading bar paint its new text before a stretch of work that does not yield. A hidden tab paints
// nothing, so this never waits more than 50ms.
const paint = () => new Promise<void>((r) => {
  requestAnimationFrame(() => setTimeout(r, 0));
  setTimeout(r, 50);
});

/** Which copy of the log the open tabs hold (meta store): a tab that finds another stops writing and reloads. */
const EPOCH = "epoch";

/** Another tab replaced the browser's copy (a backup restored, the storage changed): this page reloads. */
class CopyReplaced extends Error {}

/** Two copies of a row are the same: one version, the same values. */
const sameRow = (a: Record<string, unknown>, b: Record<string, unknown>) => rowVersion(a) === rowVersion(b) && JSON.stringify(a) === JSON.stringify(b);
const trackOf = (pointKey: string) => pointKey.slice(0, pointKey.lastIndexOf("|"));
const pointsJson = (rows: Record<string, unknown>[]) => JSON.stringify([...rows].sort((a, b) => Number(a.seq) - Number(b.seq)));

/** Tell listeners; one that throws (a page failing to render) stops neither the others nor the write that told them. */
function tell(listeners: Set<() => void>) {
  for (const l of listeners) {
    try {
      l();
    } catch (e) {
      console.error(e);
    }
  }
}

interface Edit {
  table: string;
  id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export class AppData {
  readonly store: Store;
  readonly ref: RefIndex;
  readonly tabs: Tabs;
  version = 0;
  saveState: SaveState = "saved";
  lastSavedAt: number | null = null;
  private listeners = new Set<() => void>();
  /** Rows to write to the browser's copy (the writing tab only). */
  private pending = new Map<string, { table: string; id: string; row: Record<string, unknown> | null }>();
  /** Edits for the outbox: made in a tab that does not write the copy, or before sync noted them. */
  private edits = new Map<string, Edit>();
  private editedTracks = new Set<string>();
  /** Sync's state, written with the rows it covers. */
  private syncState: SyncState | null = null;
  /** Outbox records taken into the copy and the sync queue, removed with the next write. */
  private taken = new Map<string, string>();
  /** This tab's outbox records the writing tab has not taken yet, by key, with their stamp. */
  private unacked = new Map<string, string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> = Promise.resolve();
  private heard: Promise<void> = Promise.resolve();
  private taking: Promise<void> = Promise.resolve();
  /** Which copy of the log this tab holds (EPOCH); a write finding another stops and reloads. */
  private epoch: unknown;
  private closed = false;
  /** The copy held the storage's tables when this tab read it. */
  private tablesAtOpen = false;
  private cache: { version: number; findings: Finding[]; resolvedOverlaps: ReturnType<typeof resolveAirframes>["overlaps"] } | null = null;
  /** How this browser keeps the log; null until the first run has asked (docs/32). */
  connection: Connection | null = null;
  /** Syncing, in Private and Standard mode. */
  sync: SyncHandle | null = null;
  private syncListeners = new Set<() => void>();

  private constructor(store: Store, ref: RefIndex, tabs: Tabs, connection: Connection | null, epoch: unknown, outbox: OutboxRecord[]) {
    this.store = store;
    this.ref = ref;
    this.tabs = tabs;
    this.connection = connection;
    this.epoch = epoch;
    if (tabs.role === "follower") for (const r of outbox) this.unacked.set(r.key, r.stamp);
    store.subscribe((changes) => {
      const writer = this.tabs.role === "writer";
      const outbox = this.outboxEdits();
      let write = false;
      for (const c of changes) {
        // Another tab wrote it to the copy already.
        if (c.origin === "tab") continue;
        if (writer) {
          this.pending.set(`${c.table}|${c.id}`, { table: c.table, id: c.id, row: c.after as unknown as Record<string, unknown> | null });
          write = true;
        }
        if (c.origin || !outbox) continue;
        if (c.table === "track_points") this.editedTracks.add(trackOf(c.id));
        else {
          const k = `${c.table}|${c.id}`;
          const first = this.edits.get(k);
          this.edits.set(k, { table: c.table, id: c.id, before: first ? first.before : (c.before as Record<string, unknown> | null), after: c.after as Record<string, unknown> | null });
        }
        write = true;
      }
      // The user's own operators and family choices reach the reference index as they change, by sync too:
      // a browser signed in again starts empty, and they arrive after the index was built.
      if (changes.some((c) => c.table === "operator_overrides" || c.table === "family_overrides")) this.refreshUserOverrides();
      // Rows from another device: settle what both made side by side (core reconcile.ts), once the sync has finished.
      if (changes.some((c) => c.origin === "sync")) this.scheduleReconcile();
      if (write) this.scheduleFlush();
      this.version++;
      tell(this.listeners);
    });
    tabs.listen((m) => this.hear(m));
  }

  /** `done` hears each step as it finishes; with "log", the number of records read. */
  static async open(tabs: Tabs, done: (step: OpenStep, records?: number) => void = () => {}): Promise<AppData> {
    const [tables, [rows, tracks, outbox, meta]] = await Promise.all([
      import("@touchdown/refdata").then(({ loadRefTables }): RefTables => {
        const t = loadRefTables();
        done("reference");
        return t;
      }),
      db
        .transaction("r", db.rows, db.trackPoints, db.outbox, db.meta, () =>
          Promise.all([db.rows.toArray(), db.trackPoints.toArray(), db.outbox.toArray(), db.meta.bulkGet([CONNECTION, EPOCH, "sync"])]),
        )
        .then((read) => {
          done("log", read[0].length + read[1].reduce((n, t) => n + t.rows.length, 0));
          return read;
        }),
    ]);
    await paint();
    const store = new Store({ deviceId: deviceId() });
    const byTable = new Map<string, Record<string, unknown>[]>();
    for (const r of rows) {
      const list = byTable.get(r.table);
      if (list) list.push(r.row);
      else byTable.set(r.table, [r.row]);
    }
    const points = byTable.get("track_points") ?? [];
    for (const t of tracks) points.push(...t.rows);
    if (points.length) byTable.set("track_points", points);
    // Tables the schema no longer has (agent_rules went to the CLI in schema version 4) are removed here.
    const gone = [...byTable.keys()].filter((t) => !(t in TABLES));
    if (gone.length && tabs.role === "writer") void db.rows.where("table").anyOf(gone).delete();
    const problems: string[] = [];
    for (const [table, list] of byTable) {
      if (!(table in TABLES)) continue;
      for (const row of list) {
        try {
          store.load(table as TableName, [row as never]);
        } catch (e) {
          problems.push(`${table}: ${(e as Error).message}`);
        }
      }
    }
    if (problems.length) console.warn("Rows that failed validation were not loaded:", problems);
    // Edits another tab made that the writing tab has not taken yet are shown already.
    for (const r of outbox) {
      try {
        if (r.points) {
          store.purge("track_points", store.all("track_points").filter((p) => p.trackId === r.id).map((p) => rowKey("track_points", p as never)));
          store.load("track_points", r.points as never);
        } else if (r.after && r.table in TABLES) store.load(r.table as TableName, [r.after as never]);
      } catch {
        // Left for the writing tab, which reports it.
      }
    }
    const app = new AppData(store, new RefIndex(tables, AppData.overridesFrom(store)), tabs, (meta[0]?.value as Connection | undefined) ?? null, meta[1]?.value ?? null, outbox);
    // Read with the rows, so it says whether these rows hold the storage's tables.
    app.tablesAtOpen = hasTables((meta[2]?.value as SyncState | undefined) ?? null);
    // Statuses a log from an older version keeps in a sighting's phase or notes become its phases (core phases.ts), and
    // a flight's ticket number and booking reference go to its private row (core private.ts).
    settlePhases(store);
    settlePrivate(store);
    return app;
  }

  /** Set the reference index's own operators and family choices to the ones the log holds now. */
  refreshUserOverrides() {
    this.ref.setUserOverrides(AppData.overridesFrom(this.store));
  }

  private static overridesFrom(store: Store) {
    return {
      operators: store.all("operator_overrides").map((o) => operatorFromOverride(o)),
      familyOverrides: store
        .all("family_overrides")
        .filter((o) => o.designator && o.familyId)
        .map((o) => ({ designator: o.designator!, familyId: o.familyId! })),
    };
  }

  // ---------- subscription ----------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = () => this.version;

  private notify() {
    this.version++;
    tell(this.listeners);
  }

  private reconcileTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleReconcile() {
    if (this.reconcileTimer) return;
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = null;
      this.keep(reconcile(this.store, this.ref).resolved);
    }, 0);
  }

  private scheduleFlush() {
    this.saveState = "saving";
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushNow().catch(() => undefined);
    }, 120);
  }

  /**
   * Edits go to the outbox when this tab does not write the copy, or when it does and no sync engine notes them yet
   * (sync not started, or waiting for the user): the engine takes them when it starts. Local mode has no sync.
   */
  private outboxEdits(): boolean {
    if (this.tabs.role === "follower") return true;
    const c = this.connection;
    return !!c && c.mode !== "local" && !(this.sync instanceof SyncController && this.sync.noting);
  }

  /** Write everything waiting, after any write under way; resolves once it is saved. */
  flushNow(): Promise<void> {
    const next = this.flushing.then(() => this.flush());
    this.flushing = next.catch(() => undefined);
    return next;
  }

  /** Sync's state, saved with the rows it covers in one transaction, so a reload finds both or neither. */
  private persistSync = (state: SyncState): Promise<void> => {
    this.syncState = state;
    return this.flushNow();
  };

  private async flush() {
    if (this.closed) return;
    const batch = [...this.pending.values()];
    const edits = [...this.edits.values()];
    const editedTracks = [...this.editedTracks];
    const state = this.syncState;
    const taken = [...this.taken];
    this.pending.clear();
    this.edits.clear();
    this.editedTracks.clear();
    this.syncState = null;
    this.taken.clear();
    if (!batch.length && !edits.length && !editedTracks.length && !state && !taken.length) {
      this.saveState = "saved";
      return;
    }
    const rows = batch.filter((r) => r.table !== "track_points");
    const puts = rows.filter((r) => r.row !== null) as { table: string; id: string; row: Record<string, unknown> }[];
    const dels = rows.filter((r) => r.row === null).map((r) => [r.table, r.id] as [string, string]);
    // Track points are stored one record per track: rewrite each track that changed from what the store
    // holds now, or remove its record when it has no points left. A point's key is "<trackId>|<seq>".
    const changedTracks = new Set(batch.filter((r) => r.table === "track_points").map((r) => trackOf(r.id)));
    const pointsOf = (ids: Set<string>) => groupTrackPoints(this.store.all("track_points").filter((p) => ids.has(p.trackId)) as unknown as Record<string, unknown>[]);
    const trackPuts = changedTracks.size ? pointsOf(changedTracks) : [];
    const trackDels = [...changedTracks].filter((id) => !trackPuts.some((t) => t.trackId === id));
    const outboxTracks = editedTracks.length ? pointsOf(new Set(editedTracks)) : [];
    const stamp = ulid();
    const written: OutboxRecord[] = [];
    const took: { key: string; stamp: string }[] = [];
    try {
      await db.transaction("rw", [db.rows, db.trackPoints, db.meta, db.outbox], async () => {
        if (((await db.meta.get(EPOCH))?.value ?? null) !== this.epoch) throw new CopyReplaced();
        if (puts.length) await db.rows.bulkPut(puts);
        if (dels.length) await db.rows.bulkDelete(dels);
        if (trackPuts.length) await db.trackPoints.bulkPut(trackPuts);
        if (trackDels.length) await db.trackPoints.bulkDelete(trackDels);
        if (puts.length || dels.length || changedTracks.size) await db.meta.put({ key: LAST_CHANGE, value: Date.now() });
        if (state) await db.meta.put({ key: "sync", value: state });
        // An outbox record keeps the row as it was before the first edit not taken yet.
        for (const e of edits) {
          const key = `${e.table}|${e.id}`;
          const old = await db.outbox.get(key);
          written.push({ key, table: e.table, id: e.id, before: old ? (old.before ?? null) : e.before, after: e.after, stamp });
        }
        for (const id of editedTracks) written.push({ key: `track|${id}`, table: "track_points", id, points: outboxTracks.find((t) => t.trackId === id)?.rows ?? [], stamp });
        if (written.length) await db.outbox.bulkPut(written);
        // Taken by this tab: removed, unless written again since.
        for (const [key, s] of taken) {
          if ((await db.outbox.get(key))?.stamp !== s) continue;
          await db.outbox.delete(key);
          took.push({ key, stamp: s });
        }
      });
    } catch (e) {
      if (e instanceof CopyReplaced || (e as Error)?.name === "DatabaseClosedError") {
        this.leave();
        return;
      }
      console.error(e);
      this.saveState = "error";
      // Kept for the next write; an edit made since keeps the older starting row.
      for (const r of batch) if (!this.pending.has(`${r.table}|${r.id}`)) this.pending.set(`${r.table}|${r.id}`, r);
      for (const e of edits) {
        const k = `${e.table}|${e.id}`;
        const later = this.edits.get(k);
        this.edits.set(k, later ? { ...later, before: e.before } : e);
      }
      for (const id of editedTracks) this.editedTracks.add(id);
      this.syncState ??= state;
      for (const [k, v] of taken) if (!this.taken.has(k)) this.taken.set(k, v);
      this.notify();
      throw e;
    }
    for (const r of written) this.unacked.set(r.key, r.stamp);
    if (this.tabs.role === "writer") {
      if (puts.length || dels.length || changedTracks.size || took.length) {
        const saved: SavedRow[] = [...puts, ...dels.map(([table, id]) => ({ table, id, row: null }))];
        this.tabs.post({ type: "rows", rows: saved, tracks: [...changedTracks], took });
      }
      // Its own edits, kept for sync while it was not running: taken once it starts.
      for (const r of written) this.unacked.delete(r.key);
    } else if (written.length) this.tabs.post({ type: "outbox" });
    this.saveState = this.pending.size || this.edits.size || this.editedTracks.size ? "saving" : "saved";
    this.lastSavedAt = Date.now();
    this.notify();
  }

  /** The copy was replaced in another tab: write nothing more, and reload. */
  private leave() {
    if (this.closed) return;
    this.closed = true;
    this.sync?.stop();
    location.reload();
  }

  // ---------- tabs (docs/12, "Tabs") ----------

  /** A message from another tab. The writing tab's saves are shown in the order they were made. */
  private hear(m: TabMessage) {
    if (this.closed) return;
    const failed = (e: unknown) => console.error(e);
    if (m.type === "reload") return this.leave();
    if (this.tabs.role === "writer") {
      if (m.type === "outbox") void this.takeOutbox().catch(failed);
      else if (m.type === "hello") this.tabs.post({ type: "sync", info: this.sync?.info ?? null });
      else if (m.type === "run")
        void this.takeOutbox()
          .catch(failed)
          .then(() => this.sync?.run())
          .then(() => m.id && this.tabs.post({ type: "ran", id: m.id }));
      else if (m.type === "allow") void this.sync?.allow();
      return;
    }
    if (m.type === "rows") this.heard = this.heard.then(() => this.fromWriter(m)).catch(failed);
    else if (m.type === "sync" && this.sync instanceof TabSync) this.sync.heard(m.info);
    else if (m.type === "ran" && this.sync instanceof TabSync) this.sync.ran(m.id);
  }

  /** Rows the writing tab saved: shown here as they are, except this tab's own edits until it has taken them. */
  private async fromWriter(m: Extract<TabMessage, { type: "rows" }>) {
    for (const t of m.took) if (this.unacked.get(t.key) === t.stamp) this.unacked.delete(t.key);
    const mine = (key: string) => this.unacked.has(key) || this.edits.has(key);
    this.store.batch(() => {
      for (const r of m.rows) {
        if (!(r.table in TABLES)) continue;
        const table = r.table as TableName;
        const key = `${r.table}|${r.id}`;
        const cur = this.store.peek(table, r.id) as Record<string, unknown> | null;
        if (r.row === null) {
          if (cur && !mine(key)) this.store.purge(table, [r.id], "tab");
          continue;
        }
        if (cur && sameRow(cur, r.row)) continue;
        if (mine(key) && cur && !isBasedOn(r.row, cur)) continue;
        try {
          this.store.applyRemote(table, [r.row as never], "tab");
        } catch (e) {
          console.warn(`${key}: ${(e as Error).message}`);
        }
      }
    });
    const tracks = m.tracks.filter((id) => !mine(`track|${id}`) && !this.editedTracks.has(id));
    if (tracks.length) this.showTracks(tracks, await db.trackPoints.bulkGet(tracks));
  }

  private showTracks(ids: string[], records: ({ trackId: string; rows: Record<string, unknown>[] } | undefined)[]) {
    this.store.batch(() => {
      ids.forEach((id, i) => {
        const here = this.store.all("track_points").filter((p) => p.trackId === id);
        const there = records[i]?.rows ?? [];
        if (pointsJson(here as never) === pointsJson(there)) return;
        this.store.purge("track_points", here.map((p) => rowKey("track_points", p as never)), "tab");
        if (there.length) this.store.putRaw("track_points", there as never, "tab");
      });
    });
  }

  /**
   * Take the other tabs' edits from the outbox into the copy (and into sync's queue, in one write). A row changed here
   * since that tab read it keeps both versions field by field, as two devices' do (docs/12).
   */
  takeOutbox(): Promise<void> {
    const next = this.taking.then(() => this.takeOutboxNow());
    this.taking = next.catch(() => undefined);
    return next;
  }

  private async takeOutboxNow(): Promise<void> {
    if (this.tabs.role !== "writer" || this.closed) return;
    const records = await db.outbox.toArray();
    if (!records.length) return;
    this.store.batch(() => {
      for (const r of records) {
        try {
          this.takeEdit(r);
        } catch (e) {
          console.warn(`Not taken from another tab: ${r.key}: ${(e as Error).message}`);
        }
      }
    });
    // Written to the copy even when this tab had them already (a track is written whole from what the store holds).
    for (const r of records) {
      if (r.points) this.pending.set(`track_points|${r.id}|0`, { table: "track_points", id: `${r.id}|0`, row: null });
      else if (r.table in TABLES) {
        const row = this.store.peek(r.table as TableName, r.id) as Record<string, unknown> | null;
        this.pending.set(`${r.table}|${r.id}`, { table: r.table, id: r.id, row });
      }
    }
    const c = this.connection;
    const sync = this.sync instanceof SyncController ? this.sync : null;
    if (!c || c.mode === "local") {
      for (const r of records) this.taken.set(r.key, r.stamp);
      await this.flushNow();
      return;
    }
    if (!sync?.noting) {
      // Kept until sync starts and takes them into its queue.
      await this.flushNow();
      return;
    }
    for (const r of records) this.taken.set(r.key, r.stamp);
    const queued: QueuedRow[] = records.filter((r) => !r.points && r.table in TABLES).map((r) => ({ table: r.table as TableName, key: r.id, replaces: [], base: (r.before as SyncRow | null) ?? null }));
    await sync.enqueue(queued, records.filter((r) => r.points).map((r) => r.id));
  }

  private takeEdit(r: OutboxRecord) {
    if (r.points) {
      const here = this.store.all("track_points").filter((p) => p.trackId === r.id);
      if (pointsJson(here as never) === pointsJson(r.points)) return;
      this.store.purge("track_points", here.map((p) => rowKey("track_points", p as never)));
      if (r.points.length) this.store.putRaw("track_points", r.points as never);
      return;
    }
    if (!(r.table in TABLES)) return;
    const table = r.table as TableName;
    const cur = this.store.peek(table, r.id) as Record<string, unknown> | null;
    const after = r.after ?? null;
    if (!after) {
      if (cur) this.store.purge(table, [r.id]);
      return;
    }
    if (cur && sameRow(cur, after)) return;
    if (!cur || (r.before && sameRow(cur, r.before))) {
      this.store.putRaw(table, [after as never]);
      return;
    }
    const merged = mergeRow(table, (r.before as SyncRow | null) ?? null, cur, after, isNewer(cur, after));
    this.store.merged(table, r.id, merged.values, after);
  }

  /** This tab now writes the copy: it catches up with what it may have missed, and takes over sync. */
  private async promote() {
    if (this.closed) return;
    await this.flushNow().catch(() => undefined);
    const [rows, tracks, outbox] = await db.transaction("r", db.rows, db.trackPoints, db.outbox, () => Promise.all([db.rows.toArray(), db.trackPoints.toArray(), db.outbox.toArray()]));
    // Edits not taken yet are newer than the copy: the outbox brings them in below.
    const waiting = new Set(outbox.map((r) => r.key));
    const mine = (key: string) => waiting.has(key) || this.edits.has(key);
    this.store.batch(() => {
      for (const r of rows) {
        if (r.table === "track_points" || !(r.table in TABLES) || mine(`${r.table}|${r.id}`)) continue;
        const cur = this.store.peek(r.table as TableName, r.id) as Record<string, unknown> | null;
        if (cur && sameRow(cur, r.row)) continue;
        try {
          this.store.applyRemote(r.table as TableName, [r.row as never], "tab");
        } catch {
          // Left as it is.
        }
      }
    });
    const ids = new Set([...tracks.map((t) => t.trackId), ...this.store.all("track_points").map((p) => p.trackId)]);
    const byId = new Map(tracks.map((t) => [t.trackId, t]));
    const list = [...ids].filter((id) => !mine(`track|${id}`));
    this.showTracks(list, list.map((id) => byId.get(id)));
    this.unacked.clear();
    this.sync?.stop();
    this.sync = null;
    this.syncChanged();
    await this.startSync();
    await this.takeOutbox();
  }

  // ---------- where the log lives (docs/32) ----------

  subscribeSync = (fn: () => void) => {
    this.syncListeners.add(fn);
    return () => this.syncListeners.delete(fn);
  };

  getSyncInfo = (): SyncInfo | null => this.sync?.info ?? null;

  private syncChanged = () => {
    for (const l of this.syncListeners) l();
    if (this.tabs.role === "writer") this.tabs.post({ type: "sync", info: this.sync?.info ?? null });
  };

  /**
   * Start syncing when this browser is in Private or Standard mode: in this tab when it writes the copy, else through
   * the tab that does. Resolves once the copy has the storage's tables (the first download can take a while), or sync
   * waits for the user.
   */
  startSync(): Promise<void> {
    const c = this.connection;
    if (!c || c.mode === "local" || this.sync) return Promise.resolve();
    const sync =
      this.tabs.role === "writer"
        ? new SyncController(this.store, c, { persist: this.persistSync, started: () => this.takeOutbox() })
        : new TabSync(c, this.tablesAtOpen, (m) => this.tabs.post(m), () => this.flushNow());
    this.sync = sync;
    sync.subscribe(this.syncChanged);
    this.syncChanged();
    // A tab waiting for the writer's part takes it when that tab closes.
    if (this.tabs.role === "follower") void this.tabs.whenWriter().then(() => this.promote());
    return sync.start();
  }

  /** Whether the copy lacks the storage's tables: the first download has not got that far yet. */
  async tablesMissing(): Promise<boolean> {
    const c = this.connection;
    if (!c || c.mode === "local") return false;
    return !hasTables(await savedSyncState());
  }

  /**
   * Change how this browser keeps the log. Every other tab reloads; this one becomes the writing tab if it is not
   * already. Ends once the copy has the storage's tables.
   */
  async connect(c: Connection): Promise<void> {
    this.sync?.stop();
    this.sync = null;
    const drive = (x: Connection | null) => x?.mode === "private" && x.adapter === "gdrive";
    if (drive(this.connection) && !drive(c)) await forgetGoogleToken();
    await this.flushNow().catch(() => undefined);
    const epoch = ulid();
    await db.transaction("rw", db.meta, async () => {
      // The sync position belongs to the old storage: kept, it would make tracks the new one lacks look deleted.
      const state = (await db.meta.get("sync"))?.value as SyncState | undefined;
      if (state) await db.meta.put({ key: "sync", value: { ...state, cursor: {} } });
      await db.meta.put({ key: CONNECTION, value: c });
      await db.meta.put({ key: EPOCH, value: epoch });
    });
    this.epoch = epoch;
    this.tabs.post({ type: "reload" });
    this.connection = c;
    const adapter = c.mode === "local" ? "manual" : c.adapter;
    // Settings are a synced row: on a new device, written before the first sync they would replace the log's own.
    const record = () => {
      if (this.connection !== c) return;
      this.updateSettings({ dataMode: c.mode, storageBackend: "json_tables", storageAdapter: adapter, storageAccount: c.mode !== "local" && c.adapter === "gdrive" ? c.account : null });
    };
    this.syncChanged();
    if (c.mode === "local") record();
    if (this.tabs.role === "follower") {
      // The writing tab reloads: this one takes its part, then syncs.
      await this.tabs.whenWriter();
      await this.promote();
    } else await this.startSync();
    // Set by startSync or promote; TypeScript still holds it as the null set above.
    void (this.sync as SyncHandle | null)?.synced.then(record);
  }

  markBackup() {
    void setMeta(LAST_BACKUP, Date.now());
  }

  // ---------- derived ----------

  private derived() {
    if (this.cache?.version === this.version) return this.cache;
    // Resolution is kept current by every write; this only collects overlaps for the checks.
    const overlaps = this.cache?.resolvedOverlaps ?? [];
    const findings = checkAll(this.store, this.ref, { overlaps });
    this.cache = { version: this.version, findings, resolvedOverlaps: overlaps };
    return this.cache;
  }

  /** Every finding, accepted ones included. */
  allFindings(): Finding[] {
    return this.derived().findings;
  }

  private ackIndex(): Map<string, string> {
    const m = new Map<string, string>();
    for (const a of this.store.all("issue_acks")) if (a.ruleId && a.fingerprint) m.set(`${a.ruleId}|${a.fingerprint}`, a.id);
    return m;
  }

  /** Open findings: not accepted by the user. */
  findings(): Finding[] {
    const acked = this.ackIndex();
    return this.allFindings().filter((f) => !acked.has(`${f.ruleId}|${f.fingerprint}`));
  }

  acceptedFindings(): { finding: Finding; ackId: string }[] {
    const acked = this.ackIndex();
    return this.allFindings()
      .filter((f) => acked.has(`${f.ruleId}|${f.fingerprint}`))
      .map((finding) => ({ finding, ackId: acked.get(`${finding.ruleId}|${finding.fingerprint}`)! }));
  }

  private notHere: { version: number; count: number } | null = null;

  /** Recorded tracks in the log whose points this browser's copy does not have yet (docs/12, "Sync algorithm"). */
  tracksNotHere(): number {
    if (this.notHere?.version !== this.version) {
      const here = new Set(this.store.all("track_points").map((p) => p.trackId));
      this.notHere = { version: this.version, count: this.store.all("tracks").filter((t) => !here.has(t.id)).length };
    }
    return this.notHere.count;
  }

  /** Fields edited on two devices, waiting for the user to choose (docs/12). */
  conflicts(): Row<"sync_conflicts">[] {
    return conflictsToShow(this.store);
  }

  resolveConflict(id: string, use: "kept" | "other") {
    const out = resolveConflict(this.store, this.ref, id, use);
    if (out) this.keep(out.resolved);
  }

  findingsFor(table: TableName, id: string): Finding[] {
    return this.findings().filter((f) => f.records.some((r) => r.table === table && r.id === id));
  }

  settings(): Settings {
    return settingsOf(this.store);
  }

  updateSettings(patch: Partial<Settings>) {
    updateSettings(this.store, patch);
    if (patch.theme) {
      try {
        localStorage.setItem("td-theme", patch.theme);
      } catch {
        /* storage unavailable: the setting still applies for this session */
      }
    }
  }

  // ---------- writes ----------
  // The changes themselves are in the core package (edit.ts), shared with the CLI. Each links records to airframes
  // again; its overlaps are kept for the checks, and findings worked out before they arrived are dropped.

  private keep(r: ResolveResult) {
    this.cache = { version: -1, findings: [], resolvedOverlaps: r.overlaps };
  }

  private resolve() {
    this.keep(resolveAirframes(this.store, this.ref));
  }

  saveFlight(values: Partial<FlightValues>, id?: string): Row<"flights"> {
    const r = saveFlight(this.store, this.ref, values, id);
    this.keep(r.resolved);
    return r.row;
  }

  /** `phases`: every phase it was seen in, replacing those it has. */
  saveSighting(values: Partial<SightingValues>, id?: string, tags?: string[], phases?: string[]): Row<"sightings"> {
    const r = this.store.batch(() => {
      const out = saveSighting(this.store, this.ref, values, id, tags);
      if (phases) setPhases(this.store, out.row.id, phases);
      return out;
    });
    this.keep(r.resolved);
    return r.row;
  }

  saveSightings(list: { values: Partial<SightingValues>; tags?: string[] }[]): number {
    const r = saveSightings(this.store, this.ref, list);
    this.keep(r.resolved);
    return r.count;
  }

  phasesOf(sightingId: string): string[] {
    return phasesOf(this.store, sightingId);
  }

  tagsOf(sightingId: string): string[] {
    return tagsOf(this.store, sightingId);
  }

  deleteRecord(table: "flights" | "sightings", id: string) {
    this.keep(deleteRecord(this.store, this.ref, table, id).resolved);
  }

  updateAirframe(id: string, patch: Partial<Row<"airframes">>) {
    this.keep(updateAirframe(this.store, this.ref, id, patch).resolved);
  }

  /** Move every record of `from` to `into` and remove `from` (docs/11, "Merge airframes"). */
  mergeAirframes(into: string, from: string) {
    this.keep(mergeAirframes(this.store, this.ref, into, from).resolved);
  }

  /** Apply a suggested fix; returns what to tell the user when it did more than the one record. */
  applyFix(fix: SuggestedFix): string | null {
    const r = applyFix(this.store, this.ref, fix);
    this.keep(r.resolved);
    return r.message;
  }

  acceptFinding(f: Finding, note: string | null = null) {
    acceptFinding(this.store, f, note);
  }

  reopenFinding(ackId: string) {
    reopenFinding(this.store, ackId);
  }

  setFamily(designator: string, familyId: string | null) {
    setFamily(this.store, designator, familyId);
  }

  saveView(v: SavedView) {
    saveView(this.store, v);
  }

  removeView(id: string) {
    removeView(this.store, id);
  }

  /** `agent`: the fields each row's accepted agent suggestions set (docs/22), recorded with their provenance. */
  commitImport(source: ParsedSource, matches: Match[], decisions: Map<number, CommitDecision>, agent?: { checker: "claude" | "codex"; fields: Map<number, string[]> }) {
    const r = commitImport(this.store, this.ref, source, matches, decisions, { agent });
    this.resolve();
    this.notify();
    return r;
  }

  /** Apply the changes the user took from a change file, as one import (docs/34, "The review"). */
  applyChanges(changes: InboxChange[], take: (index: number, status: ChangeStatus) => boolean, fileName: string): AppliedChanges {
    const r = applyChanges(this.store, this.ref, changes, take, { fileName });
    this.resolve();
    this.notify();
    return r;
  }

  undoImport(batchId: string, force = false) {
    const r = undoImport(this.store, this.ref, batchId, force);
    this.resolve();
    this.notify();
    return r;
  }

  /** Replace every row with a backup's rows. Validates everything first; the caller reloads the page. */
  async replaceAll(tables: Map<TableName, Record<string, unknown>[]>) {
    const fresh = new Store({ deviceId: this.store.deviceId });
    for (const [name, rows] of tables) fresh.load(name, rows as never);
    const out: { table: string; id: string; row: Record<string, unknown> }[] = [];
    const points: Record<string, unknown>[] = [];
    for (const name of Object.keys(TABLES) as TableName[]) {
      for (const r of fresh.allWithDeleted(name)) {
        const row = r as unknown as Record<string, unknown>;
        if (name === "track_points" && hasTrackKey(row)) points.push(row);
        else out.push({ table: name, id: rowKey(name, row), row });
      }
    }
    this.sync?.stop();
    this.closed = true;
    await db.transaction("rw", [db.rows, db.trackPoints, db.meta, db.outbox], async () => {
      await db.rows.clear();
      await db.trackPoints.clear();
      await db.outbox.clear();
      await db.rows.bulkPut(out);
      await db.trackPoints.bulkPut(groupTrackPoints(points));
      // Sync starts over: the next one compares every row and track with the storage.
      await db.meta.delete("sync");
      await db.meta.delete(SYNC_CHECKED);
      // Every other tab holds the old copy: it stops writing, and reloads.
      await db.meta.put({ key: EPOCH, value: ulid() });
    });
    this.tabs.post({ type: "reload" });
    renewDeviceId();
  }

  /** Remove the log, sync state and connection from this browser; the next visit is a first run. */
  async deleteEverything() {
    this.sync?.stop();
    this.closed = true;
    await db.transaction("rw", [db.rows, db.trackPoints, db.meta, db.outbox], async () => {
      await db.rows.clear();
      await db.trackPoints.clear();
      await db.outbox.clear();
      await db.meta.clear();
      await db.meta.put({ key: EPOCH, value: ulid() });
    });
    this.tabs.post({ type: "reload" });
    renewDeviceId();
  }

  /** On signing out, once everything has reached the storage: this account's database leaves the browser. */
  async removeThisBrowsersCopy() {
    this.sync?.stop();
    this.closed = true;
    this.tabs.post({ type: "reload" });
    await db.delete();
  }
}
