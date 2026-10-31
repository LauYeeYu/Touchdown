// Values derived from stored fields, never stored themselves (docs/10-domain-model.md, flights "Derived").

import type { RefIndex } from "./ref/index.ts";
import type { Flight, Sighting } from "./schema/tables.ts";
import { haversineKm } from "./geo/index.ts";
import { addDays, instant, localDateOf, minutesBetween } from "./time/index.ts";

/** Flight day: local date of takeoff, else of gate departure, else the scheduled date. */
export function flightDay(f: Pick<Flight, "takeoffAt" | "departureAt" | "scheduledDate">): string | null {
  return localDateOf(f.takeoffAt) ?? localDateOf(f.departureAt) ?? f.scheduledDate ?? null;
}

/** Destination for distance and maps: the diversion airport when there was one. */
export function arrivalAirportId(f: Pick<Flight, "toAirportId" | "divertedToAirportId">): string | null {
  return f.divertedToAirportId ?? f.toAirportId ?? null;
}

/**
 * Whether `b` is the next leg of `a`'s flight number: the same number, leaving within a day from where `a` landed. A
 * flight with a stop, or with a change of aircraft on the way, is sold as one segment of these legs, on one coupon.
 */
export function nextLegOf(a: Flight, b: Flight): boolean {
  if (!a.flightNumber || a.flightNumber !== b.flightNumber || !b.fromAirportId || arrivalAirportId(a) !== b.fromAirportId) return false;
  const landed = instant(a.landingAt) ?? instant(a.arrivalAt);
  const off = instant(b.takeoffAt) ?? instant(b.departureAt);
  if (landed !== null && off !== null) return off > landed && off - landed <= 24 * 3600_000;
  const day = flightDay(a);
  const next = flightDay(b);
  return !!day && (next === day || next === addDays(day, 1));
}

export function greatCircleKm(f: Flight, ref: RefIndex): number | null {
  const a = ref.airport(f.fromAirportId);
  const b = ref.airport(arrivalAirportId(f));
  if (!a || !b) return null;
  return haversineKm(a, b);
}

/** Distance in km: the user's override, else the great-circle distance. */
export function flightDistanceKm(f: Flight, ref: RefIndex): number | null {
  return f.distanceKmOverride ?? greatCircleKm(f, ref);
}

/** Flight time in minutes, takeoff to landing: the user's override, else computed from the instants. */
export function flightDurationMin(f: Flight): number | null {
  if (f.durationMinOverride !== null && f.durationMinOverride !== undefined) return f.durationMinOverride;
  const m = minutesBetween(f.takeoffAt, f.landingAt);
  return m !== null && m > 0 ? m : null;
}

export function airportCode(id: string | null, ref: RefIndex, style: "iata" | "icao" | "both" = "iata"): string | null {
  const a = ref.airport(id);
  if (!a) return null;
  if (style === "icao") return a.icao ?? a.iata;
  if (style === "both") return [a.iata, a.icao].filter(Boolean).join("/");
  return a.iata ?? a.icao;
}

/** Undirected route key, codes in alphabetical order (as the owner's sheet counts routes). */
export function routeKey(f: Flight, ref: RefIndex): string | null {
  const a = airportCode(f.fromAirportId, ref);
  const b = airportCode(arrivalAirportId(f), ref);
  if (!a || !b) return null;
  return [a, b].sort().join("-");
}

export function directedRouteKey(f: Flight, ref: RefIndex): string | null {
  const a = airportCode(f.fromAirportId, ref);
  const b = airportCode(arrivalAirportId(f), ref);
  if (!a || !b) return null;
  return `${a}-${b}`;
}

export function recordDate(table: "flights" | "sightings", r: Flight | Sighting): string | null {
  return table === "flights" ? flightDay(r as Flight) : (r as Sighting).seenOn;
}
