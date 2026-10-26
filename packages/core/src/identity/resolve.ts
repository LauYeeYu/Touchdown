// Links every flight and sighting to one physical airframe (docs/11-aircraft-identity.md,
// "Resolving a record to an airframe"). This is the local part: registration periods already stored.
// Lookups (step 5a–b) arrive with the lookup service in phase 4; until then an unknown registration
// gets a provisional airframe.

import type { RefIndex } from "../ref/index.ts";
import { TABLES, type Airframe, type Flight, type Sighting } from "../schema/tables.ts";
import type { Store } from "../store.ts";
import { recordDate } from "../derive.ts";
import { registrationMatchForm } from "../normalise/registration.ts";
import { listConflict } from "../conflicts.ts";
import { ulidFrom } from "../ids.ts";
import { toUtcIso } from "../time/index.ts";
import { identityKeyFor } from "./facts.ts";

export interface RegOverlap {
  table: "flights" | "sightings";
  id: string;
  registration: string;
  airframeIds: string[];
}

export interface ResolveResult {
  linked: number;
  created: number;
  removed: number;
  /** Aircraft made twice (on two devices) and merged into one. */
  merged: number;
  overlaps: RegOverlap[];
}

type RecordRef = { table: "flights" | "sightings"; row: Flight | Sighting; date: string | null };

function within(date: string | null, from: string | null, to: string | null): boolean {
  if (!date) return true;
  return (!from || from <= date) && (!to || date <= to);
}

/** Records whose airframe link the user set by hand; the resolver leaves them alone. */
export function userPinnedAirframes(store: Store): Set<string> {
  const out = new Set<string>();
  for (const p of store.all("field_provenance")) {
    if (p.field === "airframeId" && p.source === "user") out.add(`${p.ownerTable}:${p.ownerId}`);
  }
  return out;
}

function userFields(store: Store, airframeId: string): Set<string> {
  const out = new Set<string>();
  for (const p of store.all("field_provenance")) {
    if (p.ownerTable === "airframes" && p.ownerId === airframeId && p.source === "user" && p.field) out.add(p.field);
  }
  return out;
}

type Values = Record<string, unknown>;

const sameValue = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/** An aircraft's own facts: what a merge fills in from the other. */
const AIRFRAME_FACTS = TABLES.airframes.columns.map((c) => c.name as string).filter((f) => f !== "identityKey" && f !== "provisional");

/** Move everything of airframe `fromId` to `intoId`, as one aircraft, and remove `fromId`. */
function mergeAirframeInto(store: Store, intoId: string, fromId: string, now: number) {
  const target = store.get("airframes", intoId)! as unknown as Values;
  const source = store.get("airframes", fromId)! as unknown as Values;
  for (const table of ["flights", "sightings"] as const) {
    for (const r of store.all(table)) if (r.airframeId === fromId) store.update(table, r.id, { airframeId: intoId });
  }
  for (const p of store.all("registration_periods")) {
    if (p.airframeId !== fromId) continue;
    const held = store.all("registration_periods").some((q) => q.airframeId === intoId && q.registration === p.registration && q.validFrom === p.validFrom && q.validTo === p.validTo);
    if (held) store.remove("registration_periods", p.id);
    else store.update("registration_periods", p.id, { airframeId: intoId });
  }
  for (const p of store.all("operator_periods")) {
    if (p.airframeId !== fromId) continue;
    const held = store.all("operator_periods").some((q) => q.airframeId === intoId && q.operatorId === p.operatorId && q.validFrom === p.validFrom && q.validTo === p.validTo);
    if (held) store.remove("operator_periods", p.id);
    else store.update("operator_periods", p.id, { airframeId: intoId });
  }
  // Facts the user set: kept, and listed when the user set one differently on each.
  const setInto = new Set(store.all("field_provenance").filter((p) => p.ownerTable === "airframes" && p.ownerId === intoId && p.source === "user").map((p) => p.field));
  const patch: Values = {};
  for (const p of store.all("field_provenance")) {
    if (p.ownerTable !== "airframes" || p.ownerId !== fromId) continue;
    const f = p.field;
    if (p.source === "user" && f && setInto.has(f)) {
      if (!sameValue(target[f], source[f])) listConflict(store, { tableName: "airframes", recordId: intoId, field: f, kept: target[f], other: source[f], keptRow: target, otherRow: source, seed: fromId, now });
      store.remove("field_provenance", p.id);
      continue;
    }
    if (p.source === "user" && f) patch[f] = source[f];
    store.update("field_provenance", p.id, { ownerId: intoId });
  }
  for (const f of AIRFRAME_FACTS) if (!(f in patch) && target[f] == null && source[f] != null) patch[f] = source[f];
  for (const e of store.all("external_ids")) if (e.ownerTable === "airframes" && e.ownerId === fromId) store.update("external_ids", e.id, { ownerId: intoId });
  if (Object.keys(patch).length) store.update("airframes", intoId, patch as never);
  const historyId = ulidFrom(Date.parse(String(source.updatedAt)) || 0, `merged|airframes|${fromId}`);
  if (!store.peek("record_history", historyId)) {
    store.insert("record_history", { tableName: "airframes", recordId: fromId, recordRev: Number(source.rev), row: source, changedAt: toUtcIso(now), reason: "sync_conflict" }, historyId);
  }
  store.remove("airframes", fromId);
}

/**
 * Aircraft made twice, once on each of two devices before either saw the other's (docs/12, "Settling what two
 * devices made"): the same identity key, or provisional aircraft holding the same registration with no dates. Each
 * group becomes one aircraft, the same on every device (a confirmed one, else the smallest id): its records,
 * registrations and facts move to it, and a fact the user set differently on two of them is listed.
 */
export function mergeDuplicateAirframes(store: Store, now: number = Date.now()): number {
  const live = store.all("airframes");
  if (live.length < 2) return 0;
  const parent = new Map(live.map((a) => [a.id, a.id] as [string, string]));
  const root = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const first = new Map<string, string>();
  const meet = (key: string, id: string) => {
    const other = first.get(key);
    if (!other) return void first.set(key, id);
    const [a, b] = [root(other), root(id)].sort();
    if (a !== b) parent.set(b!, a!);
  };
  for (const a of live) if (a.identityKey) meet(`key:${a.identityKey}`, a.id);
  const provisional = new Set(live.filter((a) => a.provisional).map((a) => a.id));
  for (const p of store.all("registration_periods")) {
    if (p.registration && provisional.has(p.airframeId) && !p.validFrom && !p.validTo) meet(`reg:${registrationMatchForm(p.registration)}`, p.airframeId);
  }
  const groups = new Map<string, Airframe[]>();
  for (const a of live) groups.set(root(a.id), [...(groups.get(root(a.id)) ?? []), a]);
  let merged = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => Number(!!a.provisional) - Number(!!b.provisional) || (a.id < b.id ? -1 : 1));
    const [into, ...rest] = list;
    for (const from of rest) {
      mergeAirframeInto(store, into!.id, from.id, now);
      merged++;
    }
  }
  return merged;
}

/**
 * Keep each confirmed aircraft's identity key in step with its maker, serial number and type (docs/11): a key made
 * before Airbus serial number series were told apart, or before the type was known, is brought up to date. Every
 * device makes the same key, so it syncs without conflicts.
 */
function rekeyAirframes(store: Store): void {
  for (const a of store.all("airframes")) {
    if (!a.msn || !a.manufacturer || !a.identityKey?.startsWith("msn:")) continue;
    const key = identityKeyFor(a.manufacturer, a.msn, a.typeCode);
    if (key !== a.identityKey) store.update("airframes", a.id, { identityKey: key });
  }
}

export function resolveAirframes(store: Store, ref: RefIndex): ResolveResult {
  return store.batch(() => {
    rekeyAirframes(store);
    const result: ResolveResult = { linked: 0, created: 0, removed: 0, merged: mergeDuplicateAirframes(store), overlaps: [] };
    const pinned = userPinnedAirframes(store);

    // Registration (match form) → periods.
    const periods = new Map<string, { airframeId: string; from: string | null; to: string | null }[]>();
    for (const p of store.all("registration_periods")) {
      if (!p.registration || !store.get("airframes", p.airframeId)) continue;
      const key = registrationMatchForm(p.registration);
      const list = periods.get(key) ?? [];
      list.push({ airframeId: p.airframeId, from: p.validFrom, to: p.validTo });
      periods.set(key, list);
    }

    const records: RecordRef[] = [
      ...store.all("flights").map((row) => ({ table: "flights" as const, row, date: recordDate("flights", row) })),
      ...store.all("sightings").map((row) => ({ table: "sightings" as const, row, date: recordDate("sightings", row) })),
    ];
    // Oldest first, so a provisional airframe is keyed by the first date it was seen.
    records.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.row.id.localeCompare(b.row.id));

    const link = (r: RecordRef, airframeId: string | null) => {
      if (r.row.airframeId !== airframeId) {
        store.update(r.table, r.row.id, { airframeId } as never);
      }
      if (airframeId) result.linked++;
    };

    for (const r of records) {
      if (pinned.has(`${r.table}:${r.row.id}`)) {
        if (r.row.airframeId) result.linked++;
        continue;
      }
      if (!r.row.registration) {
        link(r, null);
        continue;
      }
      const key = registrationMatchForm(r.row.registration);
      const candidates = (periods.get(key) ?? []).filter((p) => within(r.date, p.from, p.to));
      const ids = [...new Set(candidates.map((c) => c.airframeId))];
      if (ids.length === 1) {
        link(r, ids[0]!);
        continue;
      }
      if (ids.length > 1) {
        result.overlaps.push({ table: r.table, id: r.row.id, registration: r.row.registration, airframeIds: ids });
        link(r, null);
        continue;
      }
      // No airframe holds this registration on that date: create a provisional one. Its registration
      // period is open at both ends, so later records with the same registration reuse it; a different
      // type code on one of them is flagged by C-TYPE-MISMATCH rather than silently split.
      const airframe = store.insert("airframes", {
        identityKey: `prov:${key}:${r.date ?? "undated"}`,
        provisional: true,
        status: "unknown",
      });
      store.insert("registration_periods", {
        airframeId: airframe.id,
        registration: r.row.registration,
        validFrom: null,
        validTo: null,
        source: "local",
      });
      periods.set(key, [...(periods.get(key) ?? []), { airframeId: airframe.id, from: null, to: null }]);
      result.created++;
      link(r, airframe.id);
    }

    result.removed = refreshAirframeFacts(store, ref);
    return result;
  });
}

function mostCommon(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  // First value wins ties: records are passed oldest first.
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
}

/**
 * Fill a provisional airframe's type, model and manufacturer from its records (the most common type,
 * oldest first on ties), keeping any value the user set. Provisional airframes left without records and
 * without user facts are removed. Returns the number removed.
 */
export function refreshAirframeFacts(store: Store, ref: RefIndex): number {
  const byAirframe = new Map<string, (Flight | Sighting)[]>();
  const all: { row: Flight | Sighting; date: string | null }[] = [
    ...store.all("flights").map((row) => ({ row, date: recordDate("flights", row) })),
    ...store.all("sightings").map((row) => ({ row, date: recordDate("sightings", row) })),
  ];
  all.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
  for (const { row } of all) {
    if (!row.airframeId) continue;
    byAirframe.set(row.airframeId, [...(byAirframe.get(row.airframeId) ?? []), row]);
  }
  let removed = 0;
  for (const a of store.all("airframes")) {
    const recs = byAirframe.get(a.id) ?? [];
    const fixed = userFields(store, a.id);
    if (!recs.length) {
      if (a.provisional && fixed.size === 0) {
        for (const p of store.all("registration_periods")) if (p.airframeId === a.id) store.remove("registration_periods", p.id);
        store.remove("airframes", a.id);
        removed++;
      }
      continue;
    }
    if (!a.provisional) continue;
    const typeCode = fixed.has("typeCode") ? a.typeCode : mostCommon(recs.map((r) => r.typeCode));
    const model = fixed.has("model")
      ? a.model
      : mostCommon(recs.filter((r) => !typeCode || r.typeCode === typeCode).map((r) => r.model));
    const manufacturer = fixed.has("manufacturer") ? a.manufacturer : (ref.manufacturerOf(typeCode) ?? a.manufacturer);
    const patch: Partial<Airframe> = {};
    if (typeCode !== a.typeCode) patch.typeCode = typeCode;
    if (model !== a.model) patch.model = model;
    if (manufacturer !== a.manufacturer) patch.manufacturer = manufacturer;
    if (Object.keys(patch).length) store.update("airframes", a.id, patch);
  }
  return removed;
}
