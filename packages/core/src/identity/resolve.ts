// Links every flight and sighting to one physical airframe (docs/11-aircraft-identity.md,
// "Resolving a record to an airframe"). This is the local part: registration periods already stored.
// Lookups (step 5a–b) arrive with the lookup service in phase 4; until then an unknown registration
// gets a provisional airframe.

import type { RefIndex } from "../ref/index.ts";
import type { Airframe, Flight, Sighting } from "../schema/tables.ts";
import type { Store } from "../store.ts";
import { recordDate } from "../derive.ts";
import { registrationMatchForm } from "../normalise/registration.ts";

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

export function resolveAirframes(store: Store, ref: RefIndex): ResolveResult {
  return store.batch(() => {
    const result: ResolveResult = { linked: 0, created: 0, removed: 0, overlaps: [] };
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
