// Statistics (docs/24-statistics.md). "Aircraft" always means distinct airframes; every metric says how
// many records it left out and why. Ties in "most frequent" are all listed.

import { t } from "@touchdown/i18n";
import type { RefIndex } from "../ref/index.ts";
import type { Airframe, Flight, Sighting } from "../schema/tables.ts";
import { arrivalAirportId, flightDay, flightDistanceKm, flightDurationMin, routeKey } from "../derive.ts";
import type { FlownDistance } from "../flown.ts";
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
  /** Each flight's distance along its recorded track (flownDistances); without it, distances are great circles. */
  flown?: ReadonlyMap<string, FlownDistance>;
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
  const km = flights.map((f) => ({ f, v: flightDistanceKm(f, ref, ctx.flown) }));
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
    y.distanceKm += flightDistanceKm(f, ref, ctx.flown) ?? 0;
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
  /** "Airline": a message, read each time it is asked for, so it is in the interface's language. */
  label: string;
  datasets: Dataset[];
  get: (r: Flight | Sighting, ctx: StatsContext, dataset: Dataset) => string | null;
  /** For a dimension a record can have several values of (a sighting's statuses): it counts under each. */
  getAll?: (r: Flight | Sighting, ctx: StatsContext, dataset: Dataset) => string[];
}

export const DIMENSIONS: Dimension[] = [
  { id: "airline", get label() { return t("view.dimension.airline"); }, datasets: ["flights", "sightings"], get: (r, _c, d) => (d === "flights" ? (r as Flight).airlineId : (r as Sighting).operatorId) },
  { id: "manufacturer", get label() { return t("view.dimension.manufacturer"); }, datasets: ["flights", "sightings"], get: (r, c) => manufacturerOf(typeOf(r, c), c) },
  { id: "family", get label() { return t("view.dimension.family"); }, datasets: ["flights", "sightings"], get: (r, c) => familyOf(typeOf(r, c), c) },
  { id: "type", get label() { return t("view.dimension.type"); }, datasets: ["flights", "sightings"], get: (r, c) => typeOf(r, c) },
  { id: "model", get label() { return t("view.dimension.model"); }, datasets: ["flights", "sightings"], get: (r) => r.model },
  { id: "regCountry", get label() { return t("view.dimension.regCountry"); }, datasets: ["flights", "sightings"], get: (r, c) => normaliseRegistration(r.registration, c.ref)?.country ?? null },
  { id: "airport", get label() { return t("view.dimension.airport"); }, datasets: ["sightings"], get: (r) => (r as Sighting).airportId },
  { id: "from", get label() { return t("view.dimension.from"); }, datasets: ["flights"], get: (r) => (r as Flight).fromAirportId },
  { id: "to", get label() { return t("view.dimension.to"); }, datasets: ["flights"], get: (r) => arrivalAirportId(r as Flight) },
  { id: "route", get label() { return t("view.dimension.route"); }, datasets: ["flights"], get: (r, c) => routeKey(r as Flight, c.ref) },
  { id: "year", get label() { return t("view.dimension.year"); }, datasets: ["flights", "sightings"], get: (r, _c, d) => (d === "flights" ? flightDay(r as Flight) : (r as Sighting).seenOn)?.slice(0, 4) ?? null },
  { id: "month", get label() { return t("view.dimension.month"); }, datasets: ["flights", "sightings"], get: (r, _c, d) => (d === "flights" ? flightDay(r as Flight) : (r as Sighting).seenOn)?.slice(5, 7) ?? null },
  { id: "hour", get label() { return t("view.dimension.hour"); }, datasets: ["flights", "sightings"], get: (r, _c, d) => (parseDateTime((d === "flights" ? (r as Flight).takeoffAt : (r as Sighting).seenAt) ?? "")?.time.slice(0, 2)) ?? null },
  { id: "cabin", get label() { return t("view.dimension.cabin"); }, datasets: ["flights"], get: (r) => (r as Flight).cabinClass },
  { id: "seatPosition", get label() { return t("view.dimension.seatPosition"); }, datasets: ["flights"], get: (r) => (r as Flight).seatPosition },
  { id: "phase", get label() { return t("view.dimension.phase"); }, datasets: ["sightings"], get: (r, c) => phasesIn(r as Sighting, c)[0] ?? null, getAll: (r, c) => phasesIn(r as Sighting, c) },
  { id: "specialLivery", get label() { return t("view.dimension.specialLivery"); }, datasets: ["flights", "sightings"], get: (r) => r.specialLivery },
];

export type Measure = "records" | "aircraft" | "distance" | "time";

/** Dimensions whose values are times (a year, a month, an hour): rows and values go in time order, not by size. */
const IN_TIME_ORDER = new Set(["year", "month", "hour"]);

/** A custom view's filter: only the records whose value of `dimension` is one of `values`. */
export interface PivotFilter {
  dimension: string;
  values: string[];
}

/** A record's values of a dimension: none when it has no value, several for a sighting seen in several phases. */
function valuesOf(dim: Dimension, r: Flight | Sighting, ctx: StatsContext, dataset: Dataset): string[] {
  if (dim.getAll) return dim.getAll(r, ctx, dataset);
  const v = dim.get(r, ctx, dataset);
  return v === null ? [] : [v];
}

/**
 * The records every filter keeps: for each filter, one of the record's values is among the filter's (filters on two
 * dimensions both hold). A filter on a dimension the dataset does not have, or with no values, keeps every record.
 */
export function filterRecords<T extends Flight | Sighting>(dataset: Dataset, records: T[], filters: PivotFilter[], ctx: StatsContext): T[] {
  const active = filters.flatMap((f) => {
    const dim = DIMENSIONS.find((d) => d.id === f.dimension);
    return dim && dim.datasets.includes(dataset) && f.values.length ? [{ dim, values: new Set(f.values) }] : [];
  });
  if (!active.length) return records;
  return records.filter((r) => active.every((f) => valuesOf(f.dim, r, ctx, dataset).some((v) => f.values.has(v))));
}

/** Each value a dimension has among the records, with how many records have it: most first, or in time order. */
export function dimensionValues(dataset: Dataset, records: (Flight | Sighting)[], dim: Dimension, ctx: StatsContext): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of records) for (const v of new Set(valuesOf(dim, r, ctx, dataset))) counts.set(v, (counts.get(v) ?? 0) + 1);
  const list = [...counts].map(([value, count]) => ({ value, count }));
  return IN_TIME_ORDER.has(dim.id) ? list.sort((a, b) => a.value.localeCompare(b.value)) : list.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/**
 * The records behind one figure of a pivot: those with `row` as their row value and `column` as their column value.
 * A null `row` or `column` takes every value there, as a total does: a row's total, a column's, or the whole table's.
 */
export function pivotRecords<T extends Flight | Sighting>(dataset: Dataset, records: T[], rowDim: Dimension, colDim: Dimension | null, row: string | null, column: string | null, ctx: StatsContext): T[] {
  const has = (values: string[], v: string | null) => (v === null ? values.length > 0 : values.includes(v));
  return records.filter((r) => has(valuesOf(rowDim, r, ctx, dataset), row) && (!colDim || has(valuesOf(colDim, r, ctx, dataset), column)));
}

export interface PivotResult {
  rows: string[];
  columns: string[]; // [""] when there is no column dimension
  cells: Map<string, number>; // `${row}\u0000${column}`
  rowTotals: Map<string, number>;
  /** Each column's figure over every row: aircraft counted once in it. */
  columnTotals: Map<string, number>;
  /** Every record counted, taken together. */
  total: number;
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
  for (const r of records) {
    const as = valuesOf(rowDim, r, ctx, dataset);
    const bs = colDim ? valuesOf(colDim, r, ctx, dataset) : [""];
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
        return list.reduce((s, r) => s + (dataset === "flights" ? (flightDistanceKm(r as Flight, ctx.ref, ctx.flown) ?? 0) : 0), 0);
      case "time":
        return list.reduce((s, r) => s + (dataset === "flights" ? (flightDurationMin(r as Flight) ?? 0) : 0), 0);
    }
  };
  const cells = new Map<string, number>();
  const rowLists = new Map<string, Set<Flight | Sighting>>();
  const colLists = new Map<string, Set<Flight | Sighting>>();
  const all = new Set<Flight | Sighting>();
  const add = (m: Map<string, Set<Flight | Sighting>>, k: string, list: (Flight | Sighting)[]) => {
    const set = m.get(k) ?? new Set();
    for (const r of list) set.add(r);
    m.set(k, set);
  };
  for (const [k, list] of groups) {
    cells.set(k, value(list));
    const [a, b] = k.split("\u0000") as [string, string];
    // A record under two rows or columns (two phases) counts once in each total.
    add(rowLists, a, list);
    add(colLists, b, list);
    for (const r of list) all.add(r);
  }
  const rowTotals = new Map([...rowLists].map(([k, set]) => [k, value([...set])]));
  const columnTotals = new Map([...colLists].map(([k, set]) => [k, value([...set])]));
  const rows = IN_TIME_ORDER.has(rowDim.id) ? [...rowTotals.keys()].sort() : [...rowTotals].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([k]) => k);
  return { rows, columns: [...colLists.keys()].sort(), cells, rowTotals, columnTotals, total: value([...all]), leftOut };
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
