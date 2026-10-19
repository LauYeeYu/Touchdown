// The app's data: the core row store, kept in memory and persisted to IndexedDB, plus the reference
// index and everything derived from them (findings, airframe links). The UI reads and writes only here.

import {
  checkAll,
  identityKeyFor,
  normaliseMsn,
  commitImport,
  normaliseFlight,
  normaliseSighting,
  operatorFromOverride,
  RefIndex,
  resolveAirframes,
  rowKey,
  Store,
  TABLES,
  toUtcIso,
  ulid,
  undoImport,
  type CommitDecision,
  type Finding,
  type FlightValues,
  type Match,
  type ParsedSource,
  type RefTables,
  type Row,
  type Settings,
  type SightingValues,
  type SuggestedFix,
  type TableName,
} from "@touchdown/core";
import { db } from "./db.ts";

export const DEFAULT_SETTINGS: Omit<Settings, "id" | "rev" | "updatedAt" | "updatedBy" | "deleted"> = {
  distanceUnit: "km",
  theme: "system",
  codeDisplay: "iata",
  modelNaming: "standard",
  agentChecker: "none",
  sendNotesToAgent: false,
  homeAirportId: null,
  storageBackend: "json_tables",
  storageAdapter: "manual",
  storageLocation: null,
};

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

export type SaveState = "saved" | "saving" | "error";

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

  private constructor(store: Store, ref: RefIndex) {
    this.store = store;
    this.ref = ref;
    store.subscribe((changes) => {
      for (const c of changes) this.pending.set(`${c.table}|${c.id}`, { table: c.table, id: c.id, row: c.after as unknown as Record<string, unknown> | null });
      this.scheduleFlush();
      this.version++;
      for (const l of this.listeners) l();
    });
  }

  static async open(): Promise<AppData> {
    const { loadRefTables } = await import("@touchdown/refdata");
    const tables: RefTables = loadRefTables();
    const store = new Store({ deviceId: deviceId() });
    const rows = await db.rows.toArray();
    const byTable = new Map<string, Record<string, unknown>[]>();
    for (const r of rows) byTable.set(r.table, [...(byTable.get(r.table) ?? []), r.row]);
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
    return app;
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
      const puts = batch.filter((r) => r.row !== null) as { table: string; id: string; row: Record<string, unknown> }[];
      const dels = batch.filter((r) => r.row === null).map((r) => [r.table, r.id] as [string, string]);
      if (puts.length) await db.rows.bulkPut(puts);
      if (dels.length) await db.rows.bulkDelete(dels);
      this.saveState = this.pending.size ? "saving" : "saved";
      this.lastSavedAt = Date.now();
    } catch (e) {
      console.error(e);
      this.saveState = "error";
      for (const r of batch) this.pending.set(`${r.table}|${r.id}`, r);
    }
    this.notify();
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

  findingsFor(table: TableName, id: string): Finding[] {
    return this.findings().filter((f) => f.records.some((r) => r.table === table && r.id === id));
  }

  settings(): Settings {
    const row = this.store.get("settings", "settings");
    return (row ?? { ...DEFAULT_SETTINGS, id: "settings", rev: 0, updatedAt: toUtcIso(0), updatedBy: "", deleted: false }) as Settings;
  }

  updateSettings(patch: Partial<Settings>) {
    if (this.store.get("settings", "settings")) this.store.update("settings", "settings", patch);
    else this.store.insert("settings", { ...DEFAULT_SETTINGS, ...patch }, "settings");
    if (patch.theme) {
      try {
        localStorage.setItem("td-theme", patch.theme);
      } catch {
        /* storage unavailable: the setting still applies for this session */
      }
    }
  }

  // ---------- writes ----------

  private resolve() {
    const r = resolveAirframes(this.store, this.ref);
    if (this.cache) this.cache.resolvedOverlaps = r.overlaps;
    else this.cache = { version: -1, findings: [], resolvedOverlaps: r.overlaps };
  }

  private history(table: TableName, id: string, reason: "edit" = "edit") {
    const cur = this.store.get(table, id);
    if (!cur) return;
    this.store.insert("record_history", {
      tableName: table,
      recordId: id,
      recordRev: (cur as { rev: number }).rev,
      row: cur as unknown as Record<string, unknown>,
      changedAt: toUtcIso(Date.now()),
      reason,
    });
  }

  saveFlight(values: Partial<FlightValues>, id?: string): Row<"flights"> {
    return this.store.batch(() => {
      const v = normaliseFlight(values, this.ref);
      let row: Row<"flights">;
      if (id) {
        this.history("flights", id);
        row = this.store.update("flights", id, v);
      } else row = this.store.insert("flights", { sourceKind: "manual", ...v });
      this.resolve();
      return this.store.get("flights", row.id)!;
    });
  }

  saveSighting(values: Partial<SightingValues>, id?: string, tags?: string[]): Row<"sightings"> {
    return this.store.batch(() => {
      const v = normaliseSighting(values, this.ref);
      let row: Row<"sightings">;
      if (id) {
        this.history("sightings", id);
        row = this.store.update("sightings", id, v);
      } else row = this.store.insert("sightings", { sourceKind: "manual", ...v });
      if (tags) this.setTags(row.id, tags);
      this.resolve();
      return this.store.get("sightings", row.id)!;
    });
  }

  saveSightings(list: { values: Partial<SightingValues>; tags?: string[] }[]): number {
    return this.store.batch(() => {
      for (const item of list) {
        const row = this.store.insert("sightings", { sourceKind: "manual", ...normaliseSighting(item.values, this.ref) });
        if (item.tags?.length) this.setTags(row.id, item.tags);
      }
      this.resolve();
      return list.length;
    });
  }

  private setTags(sightingId: string, tags: string[]) {
    const existing = this.store.all("sighting_tags").filter((t) => t.sightingId === sightingId);
    for (const t of existing) if (!tags.includes(t.tag ?? "")) this.store.remove("sighting_tags", t.id);
    const have = new Set(existing.map((t) => t.tag));
    for (const tag of tags) if (!have.has(tag)) this.store.insert("sighting_tags", { sightingId, tag });
  }

  tagsOf(sightingId: string): string[] {
    return this.store
      .all("sighting_tags")
      .filter((t) => t.sightingId === sightingId && t.tag)
      .map((t) => t.tag!);
  }

  deleteRecord(table: "flights" | "sightings", id: string) {
    this.store.batch(() => {
      this.history(table, id);
      this.store.remove(table, id);
      if (table === "sightings") for (const t of this.store.all("sighting_tags")) if (t.sightingId === id) this.store.remove("sighting_tags", t.id);
      this.resolve();
    });
  }

  updateAirframe(id: string, patch: Partial<Row<"airframes">>) {
    this.store.batch(() => {
      this.history("airframes", id);
      const cur = this.store.get("airframes", id);
      const next: Partial<Row<"airframes">> = { ...patch };
      if (patch.msn) next.msn = normaliseMsn(patch.msn);
      const maker = patch.manufacturer ?? cur?.manufacturer;
      if (patch.msn && maker) {
        // A known serial number makes the airframe confirmed (docs/11, "Set MSN").
        next.provisional = false;
        next.identityKey = identityKeyFor(maker, patch.msn);
      }
      this.store.update("airframes", id, next);
      for (const field of Object.keys(patch)) {
        this.store.insert("field_provenance", { ownerTable: "airframes", ownerId: id, field, source: "user", detail: null, recordedAt: toUtcIso(Date.now()) });
      }
      this.resolve();
    });
  }

  /** Move every record of `from` to `into` and remove `from` (docs/11, "Merge airframes"). */
  mergeAirframes(into: string, from: string) {
    this.store.batch(() => {
      for (const table of ["flights", "sightings"] as const) {
        for (const r of this.store.all(table)) {
          if (r.airframeId !== from) continue;
          this.store.update(table, r.id, { airframeId: into });
          this.store.insert("field_provenance", { ownerTable: table, ownerId: r.id, field: "airframeId", source: "user", detail: "merge", recordedAt: toUtcIso(Date.now()) });
        }
      }
      for (const p of this.store.all("registration_periods")) {
        if (p.airframeId !== from) continue;
        const dup = this.store.all("registration_periods").some((q) => q.airframeId === into && q.registration === p.registration);
        if (dup) this.store.remove("registration_periods", p.id);
        else this.store.update("registration_periods", p.id, { airframeId: into });
      }
      this.history("airframes", from);
      this.store.remove("airframes", from);
      this.resolve();
    });
  }

  applyFix(fix: SuggestedFix) {
    this.store.batch(() => {
      this.history(fix.table, fix.id);
      const patch: Record<string, unknown> = { [fix.field]: fix.value };
      for (const a of fix.also ?? []) patch[a.field] = a.value;
      // A fixed type code or registration replaces what was typed too, so raw and normalised agree.
      if (fix.field === "typeCode") patch.typeCodeRaw = fix.value;
      this.store.update(fix.table, fix.id, patch as never);
      this.resolve();
    });
  }

  acceptFinding(f: Finding, note: string | null = null) {
    this.store.batch(() => {
      const ack = this.store.insert("issue_acks", { ruleId: f.ruleId, fingerprint: f.fingerprint, note });
      for (const r of f.records) this.store.insert("issue_ack_records", { ackId: ack.id, tableName: r.table, recordId: r.id });
    });
  }

  reopenFinding(ackId: string) {
    this.store.batch(() => {
      for (const r of this.store.all("issue_ack_records")) if (r.ackId === ackId) this.store.remove("issue_ack_records", r.id);
      this.store.remove("issue_acks", ackId);
    });
  }

  commitImport(source: ParsedSource, matches: Match[], decisions: Map<number, CommitDecision>) {
    const r = commitImport(this.store, this.ref, source, matches, decisions);
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
    for (const name of Object.keys(TABLES) as TableName[]) {
      for (const r of fresh.allWithDeleted(name)) out.push({ table: name, id: rowKey(name, r as unknown as Record<string, unknown>), row: r as unknown as Record<string, unknown> });
    }
    await db.transaction("rw", db.rows, async () => {
      await db.rows.clear();
      await db.rows.bulkPut(out);
    });
  }

  async deleteEverything() {
    await db.rows.clear();
  }
}
