// Planned flights (docs/10-domain-model.md, "A flight's status"): a flight added before it flew is planned until the
// user confirms it. Its status comes from the clock wherever it is shown, and is never stored, so it changes on its own
// when the flight's time passes. Every comparison is between instants, and a date alone is read at the departure
// airport, never in the viewer's time zone.

import { greatCircleKm } from "./derive.ts";
import type { RefIndex } from "./ref/index.ts";
import type { Flight } from "./schema/tables.ts";
import { addDays, instant, todayIn, zonedInstant } from "./time/index.ts";

/** Upcoming: planned, its time to come. Due: planned, its time passed, counted but not confirmed. Flown: not planned. */
export type FlightStatus = "upcoming" | "due" | "flown";

// What a flight's status reads, from a stored flight or from values about to be saved.
type Timed = Partial<Pick<Flight, "scheduledDate" | "fromAirportId" | "toAirportId" | "divertedToAirportId" | "departureScheduledAt" | "takeoffAt" | "departureAt" | "arrivalScheduledAt" | "landingAt" | "arrivalAt">>;
type Planned = Timed & Partial<Pick<Flight, "planned">>;

/** The speed and the time on the ground that make a flight's time from its great circle, when it has no arrival. */
const CRUISE_KMH = 800;
const TAXI_MIN = 30;

/** The departure as an instant: the scheduled gate departure, else the takeoff, else the gate departure. */
export function departureInstant(f: Timed): number | null {
  return instant(f.departureScheduledAt) ?? instant(f.takeoffAt) ?? instant(f.departureAt);
}

/** The arrival as an instant: the scheduled gate arrival, else the landing, else the gate arrival. */
export function arrivalInstant(f: Timed): number | null {
  return instant(f.arrivalScheduledAt) ?? instant(f.landingAt) ?? instant(f.arrivalAt);
}

/**
 * Whether a flight's departure is still to come at `now`, which makes it planned when it is saved or imported. With
 * only a date, the date is after today at the departure airport, or, its time zone not known, where the user is.
 */
export function stillToCome(f: Timed, ref: RefIndex, now = Date.now()): boolean {
  const dep = departureInstant(f);
  if (dep !== null) return dep > now;
  if (!f.scheduledDate) return false;
  return f.scheduledDate > todayIn(ref.airport(f.fromAirportId)?.tz ?? undefined, now);
}

/**
 * When a flight's time has passed: its arrival, else its departure and the time its great circle takes (an hour
 * without the arrival airport), else the end of its date at the departure airport, or at UTC−12, where a date ends
 * last, when that airport's time zone is not known. Null without a date.
 */
export function dueAt(f: Timed, ref: RefIndex): number | null {
  const arrival = arrivalInstant(f);
  if (arrival !== null) return arrival;
  const dep = departureInstant(f);
  if (dep !== null) {
    const km = greatCircleKm({ fromAirportId: f.fromAirportId ?? null, toAirportId: f.toAirportId ?? null, divertedToAirportId: f.divertedToAirportId ?? null }, ref);
    return dep + (km === null ? 60 : (km / CRUISE_KMH) * 60 + TAXI_MIN) * 60_000;
  }
  if (!f.scheduledDate) return null;
  const next = addDays(f.scheduledDate, 1);
  const tz = ref.airport(f.fromAirportId)?.tz;
  return (tz ? zonedInstant(next, "00:00", tz) : null) ?? Date.parse(`${next}T12:00:00Z`);
}

/** A flight's status at `now`. A planned flight without a date is due: nothing says it is still to come. */
export function flightStatus(f: Planned, ref: RefIndex, now = Date.now()): FlightStatus {
  if (!f.planned) return "flown";
  const due = dueAt(f, ref);
  return due !== null && now < due ? "upcoming" : "due";
}

/** Whether a flight counts in statistics at `now`: every flight but a planned one still to come (docs/24). */
export function counted(f: Planned, ref: RefIndex, now = Date.now()): boolean {
  return flightStatus(f, ref, now) !== "upcoming";
}

/** Whether the app reminds the user to confirm a flight at `now`: due, and its reminder time, if any, come. */
export function toConfirm(f: Planned & Partial<Pick<Flight, "remindAt">>, ref: RefIndex, now = Date.now()): boolean {
  if (flightStatus(f, ref, now) !== "due") return false;
  const at = instant(f.remindAt);
  return at === null || at <= now;
}

/**
 * The next moment after `now` when a planned flight's time passes or its reminder comes, when what the app shows
 * changes without anything being written; null when none is to come.
 */
export function nextPlannedChange(flights: Iterable<Planned & Partial<Pick<Flight, "remindAt">>>, ref: RefIndex, now = Date.now()): number | null {
  let next: number | null = null;
  for (const f of flights) {
    if (!f.planned) continue;
    for (const t of [dueAt(f, ref), instant(f.remindAt)]) if (t !== null && t > now && (next === null || t < next)) next = t;
  }
  return next;
}
