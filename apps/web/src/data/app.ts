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
  openConflicts,
  resolveConflict,
  operatorFromOverride,
  RefIndex,
  reopenFinding,
  resolveAirframes,
  rowKey,
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
import { LAST_BACKUP, LAST_CHANGE, readConnection, saveConnection, setMeta, type Connection } from "./connection.ts";
import { db } from "./db.ts";
import { forgetGoogleToken } from "./google.ts";
import { forgetSyncPosition, SyncController, type SyncInfo } from "./sync.ts";
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

export class AppData {
  readonly store: Store;
  readonly ref: RefIndex;
  version = 0;
  saveState: SaveState = "saved";
  lastSavedAt: number | null = null;
  private listeners = new Set<() => void>();
  private pending = new Map<string, { table: string; id: string; row: Record<string, unknown> | null }>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private cache: { version: number; findings: Finding[]; resolvedOverlaps: ReturnType<typeof resolveAirframes>["overlaps"] } | null = null;
  /** How this browser keeps the log; null until the first run has asked (docs/32). */
  connection: Connection | null = null;
  /** Syncing, in Private mode. */
  sync: SyncController | null = null;
  private syncListeners = new Set<() => void>();

  private constructor(store: Store, ref: RefIndex) {
    this.store = store;
    this.ref = ref;
    store.subscribe((changes) => {
      for (const c of changes) this.pending.set(`${c.table}|${c.id}`, { table: c.table, id: c.id, row: c.after as unknown as Record<string, unknown> | null });
      // The user's own operators and family choices reach the reference index as they change, by sync too:
      // a browser signed in again starts empty, and they arrive after the index was built.
      if (changes.some((c) => c.table === "operator_overrides" || c.table === "family_overrides")) this.refreshUserOverrides();
      this.scheduleFlush();
      this.version++;
      for (const l of this.listeners) l();
    });
  }

  /** `done` hears each step as it finishes; with "log", the number of records read. */
  static async open(done: (step: OpenStep, records?: number) => void = () => {}): Promise<AppData> {
    const [tables, [rows, tracks]] = await Promise.all([
      import("@touchdown/refdata").then(({ loadRefTables }): RefTables => {
        const t = loadRefTables();
        done("reference");
        return t;
      }),
      db.transaction("r", db.rows, db.trackPoints, () => Promise.all([db.rows.toArray(), db.trackPoints.toArray()])).then((read) => {
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
    if (gone.length) void db.rows.where("table").anyOf(gone).delete();
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
    const app = new AppData(store, new RefIndex(tables, AppData.overridesFrom(store)));
    app.connection = await readConnection();
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
    for (const l of this.listeners) l();
  }

  private scheduleFlush() {
    this.saveState = "saving";
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => void this.flush(), 120);
  }

  private async flush() {
    this.flushTimer = null;
    const batch = [...this.pending.values()];
    this.pending.clear();
    if (!batch.length) return;
    try {
      const rows = batch.filter((r) => r.table !== "track_points");
      const puts = rows.filter((r) => r.row !== null) as { table: string; id: string; row: Record<string, unknown> }[];
      const dels = rows.filter((r) => r.row === null).map((r) => [r.table, r.id] as [string, string]);
      // Track points are stored one record per track: rewrite each track that changed from what the store
      // holds now, or remove its record when it has no points left. A point's key is "<trackId>|<seq>".
      const changedTracks = new Set(batch.filter((r) => r.table === "track_points").map((r) => r.id.slice(0, r.id.lastIndexOf("|"))));
      const trackPuts = changedTracks.size ? groupTrackPoints(this.store.all("track_points").filter((p) => changedTracks.has(p.trackId)) as unknown as Record<string, unknown>[]) : [];
      const trackDels = [...changedTracks].filter((id) => !trackPuts.some((t) => t.trackId === id));
      await db.transaction("rw", db.rows, db.trackPoints, db.meta, async () => {
        if (puts.length) await db.rows.bulkPut(puts);
        if (dels.length) await db.rows.bulkDelete(dels);
        if (trackPuts.length) await db.trackPoints.bulkPut(trackPuts);
        if (trackDels.length) await db.trackPoints.bulkDelete(trackDels);
        await db.meta.put({ key: LAST_CHANGE, value: Date.now() });
      });
      this.saveState = this.pending.size ? "saving" : "saved";
      this.lastSavedAt = Date.now();
    } catch (e) {
      console.error(e);
      this.saveState = "error";
      for (const r of batch) this.pending.set(`${r.table}|${r.id}`, r);
    }
    this.notify();
  }

  // ---------- where the log lives (docs/32) ----------

  subscribeSync = (fn: () => void) => {
    this.syncListeners.add(fn);
    return () => this.syncListeners.delete(fn);
  };

  getSyncInfo = (): SyncInfo | null => this.sync?.info ?? null;

  private syncChanged = () => {
    for (const l of this.syncListeners) l();
  };

  /** Start syncing when this browser is in Private or Standard mode. Resolves after the first sync. */
  startSync(): Promise<void> {
    const c = this.connection;
    if (!c || c.mode === "local" || this.sync) return Promise.resolve();
    this.sync = new SyncController(this.store, c);
    this.sync.subscribe(this.syncChanged);
    this.syncChanged();
    return this.sync.start();
  }

  /** Change how this browser keeps the log. In Private mode the promise ends after the first sync. */
  async connect(c: Connection): Promise<void> {
    this.sync?.stop();
    this.sync = null;
    const drive = (x: Connection | null) => x?.mode === "private" && x.adapter === "gdrive";
    if (drive(this.connection) && !drive(c)) await forgetGoogleToken();
    // The sync position belongs to the old storage: kept, it would make tracks the new one lacks look deleted.
    await forgetSyncPosition();
    await saveConnection(c);
    this.connection = c;
    const adapter = c.mode === "local" ? "manual" : c.adapter;
    // Settings are a synced row: on a new device, written before the first sync they would replace the log's own.
    const record = () => {
      if (this.connection !== c) return;
      this.updateSettings({ dataMode: c.mode, storageBackend: "json_tables", storageAdapter: adapter, storageAccount: c.mode !== "local" && c.adapter === "gdrive" ? c.account : null });
    };
    this.syncChanged();
    if (c.mode === "local") record();
    await this.startSync();
    // startSync set it; TypeScript still holds it as the null set above.
    void (this.sync as SyncController | null)?.synced.then(record);
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

  /** Fields edited on two devices, waiting for the user to choose (docs/12). */
  conflicts(): Row<"sync_conflicts">[] {
    return openConflicts(this.store);
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

  saveSighting(values: Partial<SightingValues>, id?: string, tags?: string[]): Row<"sightings"> {
    const r = saveSighting(this.store, this.ref, values, id, tags);
    this.keep(r.resolved);
    return r.row;
  }

  saveSightings(list: { values: Partial<SightingValues>; tags?: string[] }[]): number {
    const r = saveSightings(this.store, this.ref, list);
    this.keep(r.resolved);
    return r.count;
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
    await db.transaction("rw", db.rows, db.trackPoints, db.meta, async () => {
      await db.rows.clear();
      await db.trackPoints.clear();
      await db.rows.bulkPut(out);
      await db.trackPoints.bulkPut(groupTrackPoints(points));
      // Sync starts over: the next one compares every row and track with the storage.
      await db.meta.delete("sync");
    });
    renewDeviceId();
  }

  /** Remove the log, sync state and connection from this browser; the next visit is a first run. */
  async deleteEverything() {
    this.sync?.stop();
    await db.transaction("rw", db.rows, db.trackPoints, db.meta, async () => {
      await db.rows.clear();
      await db.trackPoints.clear();
      await db.meta.clear();
    });
    renewDeviceId();
  }

  /** On signing out, once everything has reached the storage: this account's database leaves the browser. */
  async removeThisBrowsersCopy() {
    this.sync?.stop();
    await db.delete();
  }
}
