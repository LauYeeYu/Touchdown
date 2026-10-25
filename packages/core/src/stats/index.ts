// Statistics (docs/24-statistics.md). "Aircraft" always means distinct airframes; every metric says how
// many records it left out and why. Ties in "most frequent" are all listed.

import type { RefIndex } from "../ref/index.ts";
import type { Airframe, Flight, Sighting } from "../schema/tables.ts";
import { arrivalAirportId, flightDay, flightDistanceKm, flightDurationMin, routeKey } from "../derive.ts";
import { normaliseRegistration } from "../normalise/registration.ts";
import { parseDateTime } from "../time/index.ts";

export interface Measured {
  value: number;
  leftOut: number; // records missing what the metric needs
}

export interface Count {
  key: string;
  count: number;
}

export interface Tally {
  items: Count[]; // sorted: count descending, then key
  top: string[]; // keys sharing the highest count
  leftOut: number;
}

function tally<T>(items: T[], key: (t: T) => string | null, distinct?: (t: T) => string | null): Tally {
  const groups = new Map<string, Set<string> | number>();
  let leftOut = 0;
  items.forEach((it, i) => {
    const k = key(it);
    const d = distinct ? distinct(it) : String(i);
    if (k === null || d === null) {
      leftOut++;
      return;
    }
    const g = groups.get(k);
    if (distinct) {
      const set = (g as Set<string> | undefined) ?? new Set<string>();
      set.add(d);
      groups.set(k, set);
    } else groups.set(k, ((g as number | undefined) ?? 0) + 1);
  });
  const list = [...groups].map(([k, v]) => ({ key: k, count: typeof v === "number" ? v : v.size }));
  list.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const max = list[0]?.count ?? 0;
  return { items: list, top: list.filter((x) => x.count === max && max > 0).map((x) => x.key), leftOut };
}

function distinctCount<T>(items: T[], key: (t: T) => string | null): Measured {
  const set = new Set<string>();
  let leftOut = 0;
  for (const it of items) {
    const k = key(it);
    if (k === null) leftOut++;
    else set.add(k);
  }
  return { value: set.size, leftOut };
}

export interface StatsContext {
  ref: RefIndex;
  airframes: Map<string, Airframe>;
  /** Each sighting's statuses (phaseIndex); without it, a sighting's `phase` alone. */
  phases?: Map<string, string[]>;
}

/** A sighting's statuses: it counts once under each. */
function phasesIn(s: Sighting, ctx: StatsContext): string[] {
  return ctx.phases?.get(s.id) ?? (s.phase ? [s.phase] : []);
}

function familyOf(typeCode: string | null, ctx: StatsContext): string | null {
  return ctx.ref.familyIdOf(typeCode);
}

function manufacturerOf(typeCode: string | null, ctx: StatsContext): string | null {
  return ctx.ref.manufacturerOf(typeCode);
}

/** Type of a record: as entered, else its airframe's. */
function typeOf(r: Flight | Sighting, ctx: StatsContext): string | null {
  return r.typeCode ?? (r.airframeId ? (ctx.airframes.get(r.airframeId)?.typeCode ?? null) : null);
}

export function provisionalCount(ids: Iterable<string>, ctx: StatsContext): number {
  let n = 0;
  for (const id of ids) if (ctx.airframes.get(id)?.provisional) n++;
  return n;
}

// ---------- flights ----------

export interface FlightRef {
  id: string;
  value: number;
}

export interface FlightStats {
  flights: number;
  distanceKm: Measured;
  minutes: Measured;
  airports: Measured;
  countries: Measured;
  airlines: Measured;
  aircraft: Measured & { provisional: number };
  types: Measured;
  routes: Measured;
  byAirline: Tally;
  byRoute: Tally;
  byManufacturer: Tally;
  byFamily: Tally;
  byType: Tally;
  byModel: Tally;
  byAirframe: Tally;
  airportVisits: Tally;
  longestByDistance: FlightRef | null;
  shortestByDistance: FlightRef | null;
  longestByTime: FlightRef | null;
  seatPositions: Tally;
  cabinClasses: Tally;
  perYear: { year: string; flights: number; distanceKm: number; minutes: number }[];
  perMonth: number[]; // 12 entries, by flight day
}

export function flightStats(flights: Flight[], ctx: StatsContext): FlightStats {
  const { ref } = ctx;
  const km = flights.map((f) => ({ f, v: flightDistanceKm(f, ref) }));
  const min = flights.map((f) => ({ f, v: flightDurationMin(f) }));
  const withKm = km.filter((x): x is { f: Flight; v: number } => x.v !== null);
  const withMin = min.filter((x): x is { f: Flight; v: number } => x.v !== null);
  const airportIds = new Set<string>();
  const countries = new Set<string>();
  let airportLeftOut = 0;
  for (const f of flights) {
    const ids = [f.fromAirportId, arrivalAirportId(f)];
    if (ids.some((x) => !x)) airportLeftOut++;
    for (const id of ids) {
      if (!id) continue;
      airportIds.add(id);
      const c = ref.airport(id)?.country;
      if (c) countries.add(c);
    }
  }
  const airframeIds = new Set(flights.map((f) => f.airframeId).filter((x): x is string => !!x));
  const visits: { f: Flight; ap: string | null }[] = flights.flatMap((f) => [
    { f, ap: f.fromAirportId },
    { f, ap: arrivalAirportId(f) },
  ]);
  const byLongest = [...withKm].sort((a, b) => b.v - a.v);
  const byTime = [...withMin].sort((a, b) => b.v - a.v);
  const years = new Map<string, { flights: number; distanceKm: number; minutes: number }>();
  const perMonth = Array(12).fill(0) as number[];
  for (const f of flights) {
    const day = flightDay(f);
    if (!day) continue;
    const y = years.get(day.slice(0, 4)) ?? { flights: 0, distanceKm: 0, minutes: 0 };
    y.flights++;
    y.distanceKm += flightDistanceKm(f, ref) ?? 0;
    y.minutes += flightDurationMin(f) ?? 0;
    years.set(day.slice(0, 4), y);
    perMonth[Number(day.slice(5, 7)) - 1]!++;
  }
  return {
    flights: flights.length,
    distanceKm: { value: withKm.reduce((s, x) => s + x.v, 0), leftOut: flights.length - withKm.length },
    minutes: { value: withMin.reduce((s, x) => s + x.v, 0), leftOut: flights.length - withMin.length },
    airports: { value: airportIds.size, leftOut: airportLeftOut },
    countries: { value: countries.size, leftOut: airportLeftOut },
    airlines: distinctCount(flights, (f) => f.airlineId),
    aircraft: { ...distinctCount(flights, (f) => f.airframeId), provisional: provisionalCount(airframeIds, ctx) },
    types: distinctCount(flights, (f) => typeOf(f, ctx)),
    routes: distinctCount(flights, (f) => routeKey(f, ref)),
    byAirline: tally(flights, (f) => f.airlineId),
    byRoute: tally(flights, (f) => routeKey(f, ref)),
    byManufacturer: tally(flights, (f) => manufacturerOf(typeOf(f, ctx), ctx)),
    byFamily: tally(flights, (f) => familyOf(typeOf(f, ctx), ctx)),
    byType: tally(flights, (f) => typeOf(f, ctx)),
    byModel: tally(flights, (f) => f.model),
    byAirframe: tally(flights, (f) => f.airframeId),
    airportVisits: tally(visits, (x) => x.ap),
    longestByDistance: byLongest[0] ? { id: byLongest[0].f.id, value: byLongest[0].v } : null,
    shortestByDistance: byLongest.length ? { id: byLongest[byLongest.length - 1]!.f.id, value: byLongest[byLongest.length - 1]!.v } : null,
    longestByTime: byTime[0] ? { id: byTime[0].f.id, value: byTime[0].v } : null,
    seatPositions: tally(flights, (f) => f.seatPosition),
    cabinClasses: tally(flights, (f) => f.cabinClass),
    perYear: [...years].sort(([a], [b]) => a.localeCompare(b)).map(([year, v]) => ({ year, ...v })),
    perMonth,
  };
}

// ---------- sightings ----------

export interface SightingStats {
  sightings: number;
  aircraft: Measured & { provisional: number };
  airlines: Measured;
  families: Measured;
  typeCodes: Measured;
  specialLiveryAircraft: Measured;
  specialLiveries: Measured;
  byAirline: Tally; // distinct airframes
  byFamily: Tally;
  byType: Tally;
  byModel: Tally;
  byManufacturer: Tally;
  byRegistrationCountry: Tally;
  byLocation: Tally; // distinct airframes per airport
  byPhase: Tally; // sightings
  sightingsByLocation: Tally;
  newPerDay: Count[]; // airframes first seen on each date
  repeats: { airframeId: string; sightings: number }[];
  perMonth: number[]; // new aircraft per month (first seen)
  airports: Measured;
}

export function sightingStats(sightings: Sighting[], ctx: StatsContext, before: Sighting[] = []): SightingStats {
  const { ref } = ctx;
  const af = (s: Sighting) => s.airframeId;
  const airframeIds = new Set(sightings.map(af).filter((x): x is string => !!x));
  // First date each airframe was seen, counting earlier periods too, so "new" means new to the log.
  const firstSeen = new Map<string, string>();
  for (const s of [...before, ...sightings]) {
    if (!s.airframeId || !s.seenOn) continue;
    const cur = firstSeen.get(s.airframeId);
    if (!cur || s.seenOn < cur) firstSeen.set(s.airframeId, s.seenOn);
  }
  const inPeriod = new Set(sightings.map((s) => s.seenOn).filter(Boolean));
  const newByDay = new Map<string, number>();
  const perMonth = Array(12).fill(0) as number[];
  for (const [id, day] of firstSeen) {
    if (!airframeIds.has(id) || !inPeriod.has(day)) continue;
    newByDay.set(day, (newByDay.get(day) ?? 0) + 1);
    perMonth[Number(day.slice(5, 7)) - 1]!++;
  }
  const perAirframe = tally(sightings, af);
  const liveryPairs = new Set<string>();
  let liveryLeftOut = 0;
  for (const s of sightings) {
    if (!s.specialLivery) {
      liveryLeftOut++;
      continue;
    }
    liveryPairs.add(`${s.operatorId ?? s.operatorRaw ?? ""}|${s.specialLivery.toLowerCase()}`);
  }
  const special = sightings.filter((s) => s.specialLivery);
  return {
    sightings: sightings.length,
    aircraft: { ...distinctCount(sightings, af), provisional: provisionalCount(airframeIds, ctx) },
    airlines: distinctCount(sightings, (s) => s.operatorId),
    families: distinctCount(sightings, (s) => familyOf(typeOf(s, ctx), ctx)),
    typeCodes: distinctCount(sightings, (s) => typeOf(s, ctx)),
    specialLiveryAircraft: { value: new Set(special.map(af).filter(Boolean)).size, leftOut: special.filter((s) => !s.airframeId).length },
    specialLiveries: { value: liveryPairs.size, leftOut: liveryLeftOut },
    byAirline: tally(sightings, (s) => s.operatorId, af),
    byFamily: tally(sightings, (s) => familyOf(typeOf(s, ctx), ctx), af),
    byType: tally(sightings, (s) => typeOf(s, ctx), af),
    byModel: tally(sightings, (s) => s.model, af),
    byManufacturer: tally(sightings, (s) => manufacturerOf(typeOf(s, ctx), ctx), af),
    byRegistrationCountry: tally(sightings, (s) => normaliseRegistration(s.registration, ref)?.country ?? null, af),
    byLocation: tally(sightings, (s) => s.airportId, af),
    byPhase: tally(
      sightings.flatMap((s) => phasesIn(s, ctx)),
      (p) => p,
    ),
    sightingsByLocation: tally(sightings, (s) => s.airportId),
    newPerDay: [...newByDay].map(([key, count]) => ({ key, count })).sort((a, b) => a.key.localeCompare(b.key)),
    repeats: perAirframe.items.filter((x) => x.count > 1).map((x) => ({ airframeId: x.key, sightings: x.count })),
    perMonth,
    airports: distinctCount(sightings, (s) => s.airportId),
  };
}

// ---------- combined ----------

export interface CombinedStats {
  flownAndPhotographed: string[]; // airframe ids
  typesFlownVsSpotted: { typeCode: string; flights: number; aircraftFlown: number; aircraftSpotted: number }[];
  spottedNeverFlown: string[]; // type codes
}

export function combinedStats(flights: Flight[], sightings: Sighting[], ctx: StatsContext): CombinedStats {
  const flown = new Set(flights.map((f) => f.airframeId).filter((x): x is string => !!x));
  const spotted = new Set(sightings.map((s) => s.airframeId).filter((x): x is string => !!x));
  const types = new Map<string, { flights: number; flown: Set<string>; spotted: Set<string> }>();
  const get = (t: string) => {
    let v = types.get(t);
    if (!v) types.set(t, (v = { flights: 0, flown: new Set(), spotted: new Set() }));
    return v;
  };
  for (const f of flights) {
    const t = typeOf(f, ctx);
    if (!t) continue;
    const v = get(t);
    v.flights++;
    if (f.airframeId) v.flown.add(f.airframeId);
  }
  for (const s of sightings) {
    const t = typeOf(s, ctx);
    if (t && s.airframeId) get(t).spotted.add(s.airframeId);
  }
  const rows = [...types].map(([typeCode, v]) => ({ typeCode, flights: v.flights, aircraftFlown: v.flown.size, aircraftSpotted: v.spotted.size }));
  rows.sort((a, b) => b.flights + b.aircraftSpotted - (a.flights + a.aircraftSpotted) || a.typeCode.localeCompare(b.typeCode));
  return {
    flownAndPhotographed: [...flown].filter((id) => spotted.has(id)),
    typesFlownVsSpotted: rows,
    spottedNeverFlown: rows.filter((r) => r.flights === 0).map((r) => r.typeCode),
  };
}

// ---------- pivot ----------

export type Dataset = "flights" | "sightings";

export interface Dimension {
  id: string;
  label: string;
  datasets: Dataset[];
  get: (r: Flight | Sighting, ctx: StatsContext, dataset: Dataset) => string | null;
  /** For a dimension a record can have several values of (a sighting's statuses): it counts under each. */
  getAll?: (r: Flight | Sighting, ctx: StatsContext, dataset: Dataset) => string[];
}

export const DIMENSIONS: Dimension[] = [
  { id: "airline", label: "Airline", datasets: ["flights", "sightings"], get: (r, _c, d) => (d === "flights" ? (r as Flight).airlineId : (r as Sighting).operatorId) },
  { id: "manufacturer", label: "Manufacturer", datasets: ["flights", "sightings"], get: (r, c) => manufacturerOf(typeOf(r, c), c) },
  { id: "family", label: "Family", datasets: ["flights", "sightings"], get: (r, c) => familyOf(typeOf(r, c), c) },
  { id: "type", label: "Type code", datasets: ["flights", "sightings"], get: (r, c) => typeOf(r, c) },
  { id: "model", label: "Model", datasets: ["flights", "sightings"], get: (r) => r.model },
  { id: "regCountry", label: "Registration country", datasets: ["flights", "sightings"], get: (r, c) => normaliseRegistration(r.registration, c.ref)?.country ?? null },
  { id: "airport", label: "Airport", datasets: ["sightings"], get: (r) => (r as Sighting).airportId },
  { id: "from", label: "From", datasets: ["flights"], get: (r) => (r as Flight).fromAirportId },
  { id: "to", label: "To", datasets: ["flights"], get: (r) => arrivalAirportId(r as Flight) },
  { id: "route", label: "Route", datasets: ["flights"], get: (r, c) => routeKey(r as Flight, c.ref) },
  { id: "year", label: "Year", datasets: ["flights", "sightings"], get: (r, _c, d) => (d === "flights" ? flightDay(r as Flight) : (r as Sighting).seenOn)?.slice(0, 4) ?? null },
  { id: "month", label: "Month", datasets: ["flights", "sightings"], get: (r, _c, d) => (d === "flights" ? flightDay(r as Flight) : (r as Sighting).seenOn)?.slice(5, 7) ?? null },
  { id: "hour", label: "Hour (local)", datasets: ["flights", "sightings"], get: (r, _c, d) => (parseDateTime((d === "flights" ? (r as Flight).takeoffAt : (r as Sighting).seenAt) ?? "")?.time.slice(0, 2)) ?? null },
  { id: "cabin", label: "Cabin class", datasets: ["flights"], get: (r) => (r as Flight).cabinClass },
  { id: "seatPosition", label: "Seat position", datasets: ["flights"], get: (r) => (r as Flight).seatPosition },
  { id: "phase", label: "Phase", datasets: ["sightings"], get: (r, c) => phasesIn(r as Sighting, c)[0] ?? null, getAll: (r, c) => phasesIn(r as Sighting, c) },
  { id: "specialLivery", label: "Special livery", datasets: ["flights", "sightings"], get: (r) => r.specialLivery },
];

export type Measure = "records" | "aircraft" | "distance" | "time";

export interface PivotResult {
  rows: string[];
  columns: string[]; // [""] when there is no column dimension
  cells: Map<string, number>; // `${row}\u0000${column}`
  rowTotals: Map<string, number>;
  leftOut: number;
}

export function pivot(
  dataset: Dataset,
  records: (Flight | Sighting)[],
  rowDim: Dimension,
  colDim: Dimension | null,
  measure: Measure,
  ctx: StatsContext,
): PivotResult {
  const groups = new Map<string, (Flight | Sighting)[]>();
  let leftOut = 0;
  const valuesOf = (dim: Dimension, r: Flight | Sighting): string[] => {
    if (dim.getAll) return dim.getAll(r, ctx, dataset);
    const v = dim.get(r, ctx, dataset);
    return v === null ? [] : [v];
  };
  for (const r of records) {
    const as = valuesOf(rowDim, r);
    const bs = colDim ? valuesOf(colDim, r) : [""];
    if (!as.length || !bs.length) {
      leftOut++;
      continue;
    }
    for (const a of as) {
      for (const b of bs) {
        const k = `${a}\u0000${b}`;
        groups.set(k, [...(groups.get(k) ?? []), r]);
      }
    }
  }
  const value = (list: (Flight | Sighting)[]): number => {
    switch (measure) {
      case "records":
        return list.length;
      case "aircraft":
        return new Set(list.map((r) => r.airframeId).filter(Boolean)).size;
      case "distance":
        return list.reduce((s, r) => s + (dataset === "flights" ? (flightDistanceKm(r as Flight, ctx.ref) ?? 0) : 0), 0);
      case "time":
        return list.reduce((s, r) => s + (dataset === "flights" ? (flightDurationMin(r as Flight) ?? 0) : 0), 0);
    }
  };
  const cells = new Map<string, number>();
  const rowLists = new Map<string, (Flight | Sighting)[]>();
  const colSet = new Set<string>();
  for (const [k, list] of groups) {
    cells.set(k, value(list));
    const [a, b] = k.split("\u0000") as [string, string];
    // A record under two columns (two statuses) counts once in its row's total.
    rowLists.set(a, [...new Set([...(rowLists.get(a) ?? []), ...list])]);
    colSet.add(b);
  }
  const rowTotals = new Map([...rowLists].map(([k, list]) => [k, value(list)]));
  const rows = [...rowTotals].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([k]) => k);
  return { rows, columns: [...colSet].sort(), cells, rowTotals, leftOut };
}


// ---------- one airport ----------

export interface AirportVisits {
  departures: Flight[]; // flights that started here (not the second leg of a connection)
  landings: Flight[]; // flights that ended here (not the first leg of a connection)
  transits: { arrive: Flight; depart: Flight }[]; // landed here, and the next flight left from here within 24 h
}

const TRANSIT_MS = 24 * 3_600_000;

/**
 * Departures, landings and transits at one airport. A transit is a landing followed by the user's next flight
 * leaving the same airport within 24 hours; it counts once, not as a landing plus a departure.
 */
export function airportVisits(flights: Flight[], airportId: string): AirportVisits {
  const ordered = [...flights].sort((a, b) => {
    const ta = instantOf(a.takeoffAt);
    const tb = instantOf(b.takeoffAt);
    if (ta !== null && tb !== null) return ta - tb;
    return (flightDay(a) ?? "").localeCompare(flightDay(b) ?? "");
  });
  const out: AirportVisits = { departures: [], landings: [], transits: [] };
  const used = new Set<string>();
  for (let i = 0; i < ordered.length; i++) {
    const f = ordered[i]!;
    const next = ordered[i + 1];
    if (arrivalAirportId(f) === airportId && next && next.fromAirportId === airportId && connects(f, next)) {
      out.transits.push({ arrive: f, depart: next });
      used.add(f.id);
      used.add(next.id);
    }
  }
  for (const f of ordered) {
    if (f.fromAirportId === airportId && !(used.has(f.id) && out.transits.some((t) => t.depart.id === f.id))) out.departures.push(f);
    if (arrivalAirportId(f) === airportId && !(used.has(f.id) && out.transits.some((t) => t.arrive.id === f.id))) out.landings.push(f);
  }
  return out;
}

function instantOf(dt: string | null): number | null {
  const p = dt ? parseDateTime(dt) : null;
  return p ? p.epochMs : null;
}

function connects(arrive: Flight, depart: Flight): boolean {
  const landed = instantOf(arrive.landingAt);
  const leaves = instantOf(depart.takeoffAt);
  if (landed !== null && leaves !== null) return leaves >= landed && leaves - landed <= TRANSIT_MS;
  // Without times, the next day at most.
  const a = (arrive.landingAt ? arrive.landingAt.slice(0, 10) : null) ?? flightDay(arrive);
  const b = flightDay(depart);
  if (!a || !b) return false;
  const days = (Date.parse(b) - Date.parse(a)) / 86_400_000;
  return days >= 0 && days <= 1;
}
