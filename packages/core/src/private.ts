// A flight's private data (docs/32-modes-and-sharing.md, "Private data"): its ticket number and booking reference,
// kept in flight_private (in the JSON tables' private/ folder) apart from the tables a share link reads. They arrive
// with the flight, as a sighting's phase does (the form, an import row, `touchdown add`); writing the flight moves
// them into flight_private, and flights.ticketNumber and flights.bookingRef stay empty in the log.

import type { Flight, FlightPrivate, Row } from "./schema/tables.ts";
import type { Store } from "./store.ts";

export const FLIGHT_PRIVATE_FIELDS = ["ticketNumber", "bookingRef"] as const;
export type FlightPrivateField = (typeof FLIGHT_PRIVATE_FIELDS)[number];
export type FlightPrivateValues = { ticketNumber: string | null; bookingRef: string | null };

/** A flight's private values: what the flight still holds on its way in, else its flight_private row. */
function valuesOf(f: Pick<Flight, FlightPrivateField> | null, p: FlightPrivate | null): FlightPrivateValues {
  return { ticketNumber: f?.ticketNumber ?? p?.ticketNumber ?? null, bookingRef: f?.bookingRef ?? p?.bookingRef ?? null };
}

/** One flight's ticket number and booking reference. */
export function privateOf(store: Store, flightId: string): FlightPrivateValues {
  return valuesOf(store.peek("flights", flightId), store.get("flight_private", flightId));
}

/** Every flight's private values that has any, by flight id. */
export function privateIndex(store: Store): Map<string, FlightPrivateValues> {
  const out = new Map<string, FlightPrivateValues>();
  for (const p of store.all("flight_private")) if (p.ticketNumber != null || p.bookingRef != null) out.set(p.flightId, valuesOf(null, p));
  for (const f of store.all("flights")) if (f.ticketNumber != null || f.bookingRef != null) out.set(f.id, valuesOf(f, store.get("flight_private", f.id)));
  return out;
}

/** A flight with its private values, as the form, an edit and the review of a change read it. */
export function withPrivate(store: Store, f: Row<"flights">): Row<"flights"> {
  return { ...f, ...privateOf(store, f.id) };
}

/**
 * Set a flight's private values: the fields given (null clears one), the others kept. The row's id is the flight's,
 * so two devices setting them for one flight make one row, which sync merges field by field.
 */
export function setPrivate(store: Store, flightId: string, values: Partial<FlightPrivateValues>) {
  const given = Object.fromEntries(FLIGHT_PRIVATE_FIELDS.filter((k) => k in values).map((k) => [k, values[k] ?? null])) as Partial<FlightPrivateValues>;
  store.batch(() => {
    if (Object.keys(given).length) {
      const row = store.peek("flight_private", flightId);
      if (!row) {
        if (Object.values(given).some((v) => v != null)) store.insert("flight_private", { flightId, ...given }, flightId);
      } else if (row.deleted) {
        const next = { ...valuesOf(null, row), ...given };
        if (next.ticketNumber != null || next.bookingRef != null) store.restore("flight_private", flightId, { flightId, ...next });
      } else store.update("flight_private", flightId, given);
    }
    // Whatever the flight still holds on its way in is settled by the values just given.
    const f = store.peek("flights", flightId);
    if (f && (f.ticketNumber != null || f.bookingRef != null)) store.update("flights", flightId, { ticketNumber: null, bookingRef: null });
  });
}

/** A flight's values without its private ones, and those apart: what saveFlight writes where. */
export function splitPrivate<T extends Record<string, unknown>>(values: T): { rest: Omit<T, FlightPrivateField>; given: Partial<FlightPrivateValues> } {
  const rest = { ...values } as Record<string, unknown>;
  const given: Partial<FlightPrivateValues> = {};
  for (const k of FLIGHT_PRIVATE_FIELDS) {
    if (!(k in rest)) continue;
    const v = rest[k];
    given[k] = typeof v === "string" && v.trim() ? v : null;
    delete rest[k];
  }
  return { rest: rest as Omit<T, FlightPrivateField>, given };
}

/**
 * Move every private value still in a flight into flight_private, and let a deleted flight's private row go with it
 * (docs/32, "Private data"): a log or a backup from before version 7, an edit queued on a device that had not
 * updated, an undone import that put an older row back. A flight's value is moved only when that version of the flight
 * is not older than the flight_private row, so an old value never replaces a newer one; it is cleared either way.
 * Every device that does it for the same rows makes the same change, so it syncs without conflicts. Changes nothing
 * when there is nothing to move.
 */
export function settlePrivate(store: Store) {
  store.batch(() => {
    for (const f of store.allWithDeleted("flights")) {
      const p = store.peek("flight_private", f.id);
      if (f.ticketNumber != null || f.bookingRef != null) {
        const newer = !p || p.deleted || f.updatedAt >= p.updatedAt;
        if (newer) {
          const given: Partial<FlightPrivateValues> = {};
          if (f.ticketNumber != null) given.ticketNumber = f.ticketNumber;
          if (f.bookingRef != null) given.bookingRef = f.bookingRef;
          setPrivate(store, f.id, given);
        } else store.update("flights", f.id, { ticketNumber: null, bookingRef: null });
      }
      // Only a flight known to be deleted takes its private row along: a flight merely missing may be on its way in
      // the same sync, and its row must stay.
      const after = store.peek("flight_private", f.id);
      if (f.deleted && after && !after.deleted) store.remove("flight_private", f.id);
    }
  });
}
