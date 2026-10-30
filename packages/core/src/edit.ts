// Changes the user makes to the log, outside imports (docs/34-command-line.md, "One implementation"): saving and
// deleting records, airframe edits and merges, suggested fixes, accepting findings, families and settings. The web
// app and the CLI apply a change with the same code. Each change keeps the version it replaces in record_history
// and links records to airframes again; the result of that linking is returned, for the checks that use it.

import { operatorFromOverride, type RefIndex } from "./ref/index.ts";
import { TABLES, type FlightValues, type Row, type Settings, type SightingValues, type TableName } from "./schema/tables.ts";
import type { Store } from "./store.ts";
import type { Finding, SuggestedFix } from "./rules/types.ts";
import { normaliseFlight, normaliseSighting } from "./normalise/record.ts";
import { namedOperator } from "./import/pipeline.ts";
import { identityKeyFor, normaliseMsn } from "./identity/facts.ts";
import { resolveAirframes, type ResolveResult } from "./identity/resolve.ts";
import { toUtcIso } from "./time/index.ts";
import { setPhases } from "./phases.ts";
import { setPrivate, splitPrivate } from "./private.ts";

export interface EditOptions {
  /** The time recorded in history and provenance; defaults to now. */
  now?: number;
  /** False when the change is part of an import, which keeps its own history of every row it touches. */
  history?: boolean;
  /**
   * Normalised fields given in the values that stay as given, not read again from their raw value: a value fixed
   * after it was typed (a suggested fix, the agent check) that a change to other fields leaves alone.
   */
  keepNormalised?: string[];
}

/** The normalised record, with the fields to keep as the values give them. */
const kept = <T extends object>(normalised: T, values: object, keep: string[] | undefined): T =>
  keep?.length ? { ...normalised, ...Object.fromEntries(keep.filter((k) => k in values).map((k) => [k, (values as Record<string, unknown>)[k]])) } : normalised;

export const DEFAULT_SETTINGS: Omit<Settings, "id" | "rev" | "updatedAt" | "updatedBy" | "basedOn" | "versionVector" | "deleted"> = {
  distanceUnit: "km",
  theme: "system",
  codeDisplay: "iata",
  modelNaming: "standard",
  homeAirportId: null,
  dataMode: null,
  storageBackend: "json_tables",
  storageAdapter: "manual",
  storageLocation: null,
  storageAccount: null,
};

/** Keep the current version of a record in record_history before the user changes it. */
export function keepHistory(store: Store, table: TableName, id: string, opts: EditOptions = {}) {
  if (opts.history === false) return;
  const cur = store.get(table, id);
  if (!cur) return;
  store.insert("record_history", {
    tableName: table,
    recordId: id,
    recordRev: (cur as { rev: number }).rev,
    row: cur as unknown as Record<string, unknown>,
    changedAt: toUtcIso(opts.now ?? Date.now()),
    reason: "edit",
  });
}

/** A company's name in the airline field ("Hyundai") becomes the user's own operator, as on import. */
function withNamedOperator<T extends Partial<FlightValues> | Partial<SightingValues>>(store: Store, ref: RefIndex, v: T, raw: "airlineRaw" | "operatorRaw", id: "airlineId" | "operatorId"): T {
  const values = v as Record<string, unknown>;
  if (values[id]) return v;
  const op = namedOperator(store, ref, values[raw] as string | null);
  return op ? ({ ...v, [id]: op.id } as T) : v;
}

/**
 * Add a flight, or change one (`id`). A ticket number or booking reference in `values` goes to the flight's private
 * row, never into the flight (docs/32, "Private data"); one not given is kept, and null clears it.
 */
export function saveFlight(store: Store, ref: RefIndex, values: Partial<FlightValues>, id?: string, opts: EditOptions = {}): { row: Row<"flights">; resolved: ResolveResult } {
  return store.batch(() => {
    const { rest, given } = splitPrivate(values);
    const v = withNamedOperator(store, ref, kept(normaliseFlight(rest, ref), rest, opts.keepNormalised), "airlineRaw", "airlineId");
    let row: Row<"flights">;
    if (id) {
      keepHistory(store, "flights", id, opts);
      if (Object.keys(given).length) keepHistory(store, "flight_private", id, opts);
      row = store.update("flights", id, v);
    } else row = store.insert("flights", { sourceKind: "manual", ...v });
    if (Object.keys(given).length || row.ticketNumber != null || row.bookingRef != null) setPrivate(store, row.id, given);
    const resolved = resolveAirframes(store, ref);
    return { row: store.get("flights", row.id)!, resolved };
  });
}

function setTags(store: Store, sightingId: string, tags: string[]) {
  const existing = store.all("sighting_tags").filter((t) => t.sightingId === sightingId);
  for (const t of existing) if (!tags.includes(t.tag ?? "")) store.remove("sighting_tags", t.id);
  const have = new Set(existing.map((t) => t.tag));
  for (const tag of tags) if (!have.has(tag)) store.insert("sighting_tags", { sightingId, tag });
}

export function tagsOf(store: Store, sightingId: string): string[] {
  return store
    .all("sighting_tags")
    .filter((t) => t.sightingId === sightingId && t.tag)
    .map((t) => t.tag!);
}

/**
 * Add a sighting, or change one (`id`); `tags` replaces its tags when given. A `phase` in `values` sets its statuses
 * to that one (null: none); `setPhases` sets several.
 */
export function saveSighting(store: Store, ref: RefIndex, values: Partial<SightingValues>, id?: string, tags?: string[], opts: EditOptions = {}): { row: Row<"sightings">; resolved: ResolveResult } {
  return store.batch(() => {
    const v = withNamedOperator(store, ref, kept(normaliseSighting(values, ref), values, opts.keepNormalised), "operatorRaw", "operatorId");
    let row: Row<"sightings">;
    if (id) {
      keepHistory(store, "sightings", id, opts);
      row = store.update("sightings", id, v);
    } else row = store.insert("sightings", { sourceKind: "manual", ...v });
    if (tags) setTags(store, row.id, tags);
    if ("phase" in values) setPhases(store, row.id, [values.phase]);
    const resolved = resolveAirframes(store, ref);
    return { row: store.get("sightings", row.id)!, resolved };
  });
}

/** Add the sightings of a session at once. */
export function saveSightings(store: Store, ref: RefIndex, list: { values: Partial<SightingValues>; tags?: string[] }[]): { count: number; resolved: ResolveResult } {
  return store.batch(() => {
    for (const item of list) {
      const row = store.insert("sightings", { sourceKind: "manual", ...withNamedOperator(store, ref, normaliseSighting(item.values, ref), "operatorRaw", "operatorId") });
      if (item.tags?.length) setTags(store, row.id, item.tags);
      if (item.values.phase) setPhases(store, row.id, [item.values.phase]);
    }
    return { count: list.length, resolved: resolveAirframes(store, ref) };
  });
}

/**
 * Delete a flight or a sighting: a flight's private row, a sighting's tags and statuses, and the record's photo links
 * go with it.
 */
export function deleteRecord(store: Store, ref: RefIndex, table: "flights" | "sightings", id: string, opts: EditOptions = {}): { resolved: ResolveResult } {
  return store.batch(() => {
    keepHistory(store, table, id, opts);
    store.remove(table, id);
    if (table === "flights" && store.get("flight_private", id)) store.remove("flight_private", id);
    if (table === "sightings") for (const t of store.all("sighting_tags")) if (t.sightingId === id) store.remove("sighting_tags", t.id);
    if (table === "sightings") for (const p of store.all("sighting_phases")) if (p.sightingId === id) store.remove("sighting_phases", p.id);
    for (const p of store.all("photo_links")) if (p.ownerTable === table && p.ownerId === id) store.remove("photo_links", p.id);
    return { resolved: resolveAirframes(store, ref) };
  });
}

/** Change an airframe's facts; a serial number makes it confirmed (docs/11, "Set MSN"). */
export function updateAirframe(store: Store, ref: RefIndex, id: string, patch: Partial<Row<"airframes">>, opts: EditOptions = {}): { resolved: ResolveResult } {
  return store.batch(() => {
    keepHistory(store, "airframes", id, opts);
    const cur = store.get("airframes", id);
    const next: Partial<Row<"airframes">> = { ...patch };
    if (patch.msn) next.msn = normaliseMsn(patch.msn);
    const maker = patch.manufacturer ?? cur?.manufacturer;
    if (patch.msn && maker) {
      next.provisional = false;
      next.identityKey = identityKeyFor(maker, patch.msn, patch.typeCode ?? cur?.typeCode);
    }
    store.update("airframes", id, next);
    for (const field of Object.keys(patch)) {
      store.insert("field_provenance", { ownerTable: "airframes", ownerId: id, field, source: "user", detail: null, recordedAt: toUtcIso(opts.now ?? Date.now()) });
    }
    return { resolved: resolveAirframes(store, ref) };
  });
}

/** Move every record of `from` to `into` and remove `from` (docs/11, "Merge airframes"). */
export function mergeAirframes(store: Store, ref: RefIndex, into: string, from: string, opts: EditOptions = {}): { resolved: ResolveResult } {
  return store.batch(() => {
    for (const table of ["flights", "sightings"] as const) {
      for (const r of store.all(table)) {
        if (r.airframeId !== from) continue;
        store.update(table, r.id, { airframeId: into });
        store.insert("field_provenance", { ownerTable: table, ownerId: r.id, field: "airframeId", source: "user", detail: "merge", recordedAt: toUtcIso(opts.now ?? Date.now()) });
      }
    }
    for (const p of store.all("registration_periods")) {
      if (p.airframeId !== from) continue;
      const dup = store.all("registration_periods").some((q) => q.airframeId === into && q.registration === p.registration);
      if (dup) store.remove("registration_periods", p.id);
      else store.update("registration_periods", p.id, { airframeId: into });
    }
    keepHistory(store, "airframes", from, opts);
    store.remove("airframes", from);
    return { resolved: resolveAirframes(store, ref) };
  });
}

/** Add a name as the user's own operator and link every flight and sighting that has it and no known operator. */
export function addNamedOperator(store: Store, ref: RefIndex, name: string, opts: EditOptions = {}): { linked: number; message: string; resolved: ResolveResult } {
  const key = (s: string | null) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return store.batch(() => {
    let linked = 0;
    const op = namedOperator(store, ref, name);
    if (op) {
      for (const f of store.all("flights")) {
        if (ref.operator(f.airlineId) || key(f.airlineRaw) !== key(name)) continue;
        keepHistory(store, "flights", f.id, opts);
        store.update("flights", f.id, { airlineId: op.id });
        linked++;
      }
      for (const s of store.all("sightings")) {
        if (ref.operator(s.operatorId) || key(s.operatorRaw) !== key(name)) continue;
        keepHistory(store, "sightings", s.id, opts);
        store.update("sightings", s.id, { operatorId: op.id });
        linked++;
      }
    }
    const message = `Added ${name.trim()} as an operator and linked ${linked === 1 ? "1 entry" : `${linked} entries`} to it.`;
    return { linked, message, resolved: resolveAirframes(store, ref) };
  });
}

/** Apply a suggested fix; `message` says what it did when that was more than the one record. */
export function applyFix(store: Store, ref: RefIndex, fix: SuggestedFix, opts: EditOptions = {}): { message: string | null; resolved: ResolveResult } {
  if (fix.operatorName) {
    const r = addNamedOperator(store, ref, fix.operatorName, opts);
    return { message: r.message, resolved: r.resolved };
  }
  return store.batch(() => {
    keepHistory(store, fix.table, fix.id, opts);
    const patch: Record<string, unknown> = { [fix.field]: fix.value };
    for (const a of fix.also ?? []) patch[a.field] = a.value;
    // A fixed type code replaces what was typed too, so raw and normalised agree.
    if (fix.field === "typeCode") patch.typeCodeRaw = fix.value;
    store.update(fix.table, fix.id, patch as never);
    return { message: null, resolved: resolveAirframes(store, ref) };
  });
}

/** "This looks right": the finding stays closed until the values it was about change. */
export function acceptFinding(store: Store, f: Finding, note: string | null = null): string {
  return store.batch(() => {
    const ack = store.insert("issue_acks", { ruleId: f.ruleId, fingerprint: f.fingerprint, note });
    for (const r of f.records) store.insert("issue_ack_records", { ackId: ack.id, tableName: r.table, recordId: r.id });
    return ack.id;
  });
}

/** Reopen an accepted finding: every acceptance of it goes, also one made on another device at the same time. */
export function reopenFinding(store: Store, ackId: string) {
  store.batch(() => {
    const ack = store.get("issue_acks", ackId);
    const all = store.all("issue_acks").filter((a) => a.id === ackId || (!!ack && a.ruleId === ack.ruleId && a.fingerprint === ack.fingerprint));
    for (const a of all) {
      for (const r of store.all("issue_ack_records")) if (r.ackId === a.id) store.remove("issue_ack_records", r.id);
      store.remove("issue_acks", a.id);
    }
  });
}

/**
 * Fields edited on two devices before either saw the other's edit, not settled yet (docs/12, "Sync algorithm"), the
 * oldest first. Those whose record is deleted or gone are left out.
 */
export function openConflicts(store: Store): Row<"sync_conflicts">[] {
  return store
    .all("sync_conflicts")
    .filter((c) => !c.resolvedAt && c.tableName in TABLES && store.get(c.tableName as TableName, c.recordId))
    .sort((a, b) => String(a.detectedAt).localeCompare(String(b.detectedAt)) || a.id.localeCompare(b.id));
}

/** Open conflicts as the user sees them: a value as typed ("registrationRaw") goes with its normalised field. */
export function conflictsToShow(store: Store): Row<"sync_conflicts">[] {
  const all = openConflicts(store);
  return all.filter((c) => !(c.field.endsWith("Raw") && all.some((x) => x.tableName === c.tableName && x.recordId === c.recordId && x.field === c.field.slice(0, -3))));
}

/**
 * Settle a field edited on two devices: keep the value the log has now, or use the other device's ("other"). The
 * choice syncs like any edit, so the conflict closes on every device.
 */
export function resolveConflict(store: Store, ref: RefIndex, id: string, use: "kept" | "other", opts: EditOptions = {}): { resolved: ResolveResult } | null {
  const c = store.get("sync_conflicts", id);
  if (!c || !(c.tableName in TABLES)) return null;
  const table = c.tableName as TableName;
  // A value as typed and its normalised form ("registrationRaw" and "registration") are settled together.
  const pair = (f: string) => (f.endsWith("Raw") ? f.slice(0, -3) : `${f}Raw`);
  const together = [c, ...openConflicts(store).filter((x) => x.id !== c.id && x.tableName === c.tableName && x.recordId === c.recordId && x.field === pair(c.field))];
  return store.batch(() => {
    if (use === "other") {
      keepHistory(store, table, c.recordId, opts);
      for (const x of together) {
        const other = JSON.parse(x.otherValue ?? "null") as unknown;
        if (x.field === "deleted") {
          if (other !== true) continue;
          // As a deletion by the user: a sighting's tags go with it.
          if (table === "flights" || table === "sightings") deleteRecord(store, ref, table, c.recordId, { ...opts, history: false });
          else store.remove(table, c.recordId);
        } else if (table === "flights" && (x.field === "ticketNumber" || x.field === "bookingRef")) {
          // A conflict listed before private data had its own table: the value goes where the flight's is kept now.
          if (store.get("flights", c.recordId)) setPrivate(store, c.recordId, { [x.field]: (other as string | null) ?? null });
        } else if (store.get(table, c.recordId)) store.update(table, c.recordId, { [x.field]: other } as never);
      }
    }
    for (const x of together) store.update("sync_conflicts", x.id, { resolvedAt: toUtcIso(opts.now ?? Date.now()), resolution: use });
    return { resolved: resolveAirframes(store, ref) };
  });
}

/** Count a type in another family in the statistics, or (`familyId` null) in its own again. */
export function setFamily(store: Store, designator: string, familyId: string | null) {
  store.batch(() => {
    for (const o of store.all("family_overrides")) if (o.designator === designator) store.remove("family_overrides", o.id);
    if (familyId) store.insert("family_overrides", { designator, familyId });
  });
}

/** A view of the Statistics page's Custom tab, kept by name (docs/24). */
export interface SavedView {
  name: string;
  dataset: "flights" | "sightings";
  rowDimension: string;
  columnDimension: string | null;
  measure: "records" | "aircraft" | "distance" | "time";
}

export function saveView(store: Store, v: SavedView): Row<"saved_views"> {
  return store.insert("saved_views", v);
}

/** Remove a saved view, with its filters. */
export function removeView(store: Store, id: string) {
  store.batch(() => {
    for (const f of store.all("saved_view_filters")) if (f.viewId === id) store.remove("saved_view_filters", f.id);
    store.remove("saved_views", id);
  });
}

/** The user's own operators and family choices, for the reference index (RefIndex.setUserOverrides). */
export function refOverridesOf(store: Store) {
  return {
    operators: store.all("operator_overrides").map((o) => operatorFromOverride(o)),
    familyOverrides: store
      .all("family_overrides")
      .filter((o) => o.designator && o.familyId)
      .map((o) => ({ designator: o.designator!, familyId: o.familyId! })),
  };
}

/** The log's settings, with the defaults for a log that has none yet. */
export function settingsOf(store: Store): Settings {
  const row = store.get("settings", "settings");
  return (row ?? { ...DEFAULT_SETTINGS, id: "settings", rev: 0, updatedAt: toUtcIso(0), updatedBy: "", basedOn: null, versionVector: null, deleted: false }) as Settings;
}

export function updateSettings(store: Store, patch: Partial<Settings>) {
  if (store.get("settings", "settings")) store.update("settings", "settings", patch);
  else store.insert("settings", { ...DEFAULT_SETTINGS, ...patch }, "settings");
}
