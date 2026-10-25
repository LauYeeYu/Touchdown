// A sighting's statuses (docs/10, "sighting_phases"): every status it was seen in, all equal, shown and counted in
// the same fixed order (PHASES), never by which came first. A status arrives one at a time, in a record's `phase`
// (an import row, a spotting line, an edit); writing the record moves it into sighting_phases (settlePhases).

import { ulidFrom } from "./ids.ts";
import { PHASES, type Row } from "./schema/tables.ts";
import type { Store } from "./store.ts";

export type Phase = (typeof PHASES)[number];

const order = (list: Iterable<string | null | undefined>): Phase[] => {
  const set = new Set(list);
  return PHASES.filter((p) => set.has(p));
};

/** Every sighting's statuses, by sighting id. */
export function phaseIndex(store: Store): Map<string, Phase[]> {
  const raw = new Map<string, string[]>();
  for (const p of store.all("sighting_phases")) raw.set(p.sightingId, [...(raw.get(p.sightingId) ?? []), p.phase]);
  // A status not moved yet (a log written by an older version) counts too.
  for (const s of store.all("sightings")) if (s.phase) raw.set(s.id, [...(raw.get(s.id) ?? []), s.phase]);
  return new Map([...raw].map(([id, list]) => [id, order(list)]));
}

/** One sighting's statuses. */
export function phasesOf(store: Store, sightingId: string): Phase[] {
  const s = store.get("sightings", sightingId);
  return order([...store.all("sighting_phases").filter((p) => p.sightingId === sightingId).map((p) => p.phase), s?.phase]);
}

/** Add statuses to a sighting (those it has stay). */
export function addPhases(store: Store, sightingId: string, phases: (string | null | undefined)[]) {
  const have = new Set(store.all("sighting_phases").filter((p) => p.sightingId === sightingId).map((p) => p.phase));
  for (const p of order(phases)) if (!have.has(p)) store.insert("sighting_phases", { sightingId, phase: p });
}

/** Set a sighting's statuses to exactly these. */
export function setPhases(store: Store, sightingId: string, phases: (string | null | undefined)[]) {
  store.batch(() => {
    const keep = new Set(order(phases));
    for (const p of store.all("sighting_phases")) if (p.sightingId === sightingId && !keep.has(p.phase)) store.remove("sighting_phases", p.id);
    addPhases(store, sightingId, [...keep]);
    if (store.get("sightings", sightingId)?.phase) store.update("sightings", sightingId, { phase: null });
  });
}

/** Statuses an older import kept in a sighting's notes when it folded a repeated sighting in: "Also taxiing". */
const ALSO = new RegExp(`^Also (${PHASES.map((p) => p.replace(/_/g, " ")).join("|")})$`);

/**
 * Move every status still in a record (`phase`, and "Also …" in the notes an older import wrote) into the
 * sighting's statuses, adding to those it has. Every device that does it for the same version of a sighting makes
 * the same rows, so it syncs without duplicates. Changes nothing when there is nothing to move.
 */
export function settlePhases(store: Store) {
  store.batch(() => {
    for (const s of store.all("sightings")) {
      const parts = (s.notes ?? "").split("; ");
      const also = parts.map((x) => ALSO.exec(x.trim())?.[1]?.replace(/ /g, "_")).filter((p): p is string => !!p);
      if (!s.phase && !also.length) continue;
      const have = new Set(store.all("sighting_phases").filter((p) => p.sightingId === s.id).map((p) => p.phase));
      for (const p of order([s.phase, ...also])) {
        if (have.has(p)) continue;
        const id = ulidFrom(Date.parse(s.updatedAt) || 0, `phase|${s.id}|${p}|${s.updatedAt}|${s.updatedBy}|${s.rev}`);
        if (!store.peek("sighting_phases", id)) store.insert("sighting_phases", { sightingId: s.id, phase: p }, id);
      }
      const notes = also.length ? parts.filter((x) => !ALSO.test(x.trim())).join("; ") || null : s.notes;
      store.update("sightings", s.id, { phase: null, notes } as Partial<Row<"sightings">>);
    }
  });
}
