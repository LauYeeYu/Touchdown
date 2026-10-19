// Data shaped for the pages, derived from the stored rows. Nothing here is stored.

import {
  flightDay,
  flightDistanceKm,
  flightDurationMin,
  routeKey,
  type Airframe,
  type Flight,
  type RefIndex,
  type Sighting,
  type Store,
} from "@touchdown/core";
import { inPeriod } from "./period.ts";
import { textCode } from "./codes.ts";

export interface FlightView {
  f: Flight;
  day: string | null;
  km: number | null;
  min: number | null;
  route: string | null;
  fromCode: string;
  toCode: string;
}

export function viewFlight(f: Flight, ref: RefIndex): FlightView {
  const from = ref.airport(f.fromAirportId);
  const to = ref.airport(f.divertedToAirportId ?? f.toAirportId);
  return {
    f,
    day: flightDay(f),
    km: flightDistanceKm(f, ref),
    min: flightDurationMin(f),
    route: routeKey(f, ref),
    // As text, in the user's codes ("LHR", "EGLL" or "LHR/EGLL"); large type and maps use primaryCode.
    fromCode: textCode(from, f.fromRaw) || "?",
    toCode: textCode(to, f.toRaw) || "?",
  };
}

/** Flights in time order (by takeoff instant where known, else flight day). */
export function sortedFlights(store: Store, ref: RefIndex): FlightView[] {
  return store
    .all("flights")
    .map((f) => viewFlight(f, ref))
    .sort((a, b) => (a.f.takeoffAt && b.f.takeoffAt ? Date.parse(a.f.takeoffAt) - Date.parse(b.f.takeoffAt) : (a.day ?? "").localeCompare(b.day ?? "")) || a.f.id.localeCompare(b.f.id));
}

export interface Session {
  key: string;
  date: string | null;
  airportId: string | null;
  sightings: Sighting[];
  aircraft: number; // distinct airframes
  newAircraft: number; // airframes first seen in the whole log in this session
}

/** Spotting sessions: sightings grouped by day and place. */
export function sessionsOf(store: Store): Session[] {
  const all = store.all("sightings");
  const firstSeen = new Map<string, string>();
  for (const s of all) {
    if (!s.airframeId) continue;
    const key = `${s.seenOn ?? "9999"}|${s.airportId ?? ""}`;
    const cur = firstSeen.get(s.airframeId);
    if (!cur || key < cur) firstSeen.set(s.airframeId, key);
  }
  const groups = new Map<string, Sighting[]>();
  for (const s of all) {
    const key = `${s.seenOn ?? "9999"}|${s.airportId ?? s.airportRaw ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  return [...groups]
    .map(([key, sightings]) => {
      const ids = new Set(sightings.map((s) => s.airframeId).filter((x): x is string => !!x));
      let fresh = 0;
      for (const id of ids) if (firstSeen.get(id) === key) fresh++;
      return { key, date: sightings[0]!.seenOn, airportId: sightings[0]!.airportId, sightings, aircraft: ids.size, newAircraft: fresh };
    })
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.key.localeCompare(b.key));
}

export interface BothEntry {
  airframe: Airframe;
  flight: Flight;
  sighting: Sighting;
}

/** Aircraft flown on and photographed, both within the period. */
export function flownAndPhotographed(store: Store, year: string): BothEntry[] {
  const flights = store.all("flights").filter((f) => f.airframeId && inPeriod(flightDay(f), year));
  const sightings = store.all("sightings").filter((s) => s.airframeId && inPeriod(s.seenOn, year));
  const sByAirframe = new Map<string, Sighting>();
  for (const s of sightings.sort((a, b) => (a.seenOn ?? "").localeCompare(b.seenOn ?? ""))) if (!sByAirframe.has(s.airframeId!)) sByAirframe.set(s.airframeId!, s);
  const out = new Map<string, BothEntry>();
  for (const f of flights.sort((a, b) => (flightDay(a) ?? "").localeCompare(flightDay(b) ?? ""))) {
    const s = sByAirframe.get(f.airframeId!);
    const a = store.get("airframes", f.airframeId);
    if (s && a && !out.has(a.id)) out.set(a.id, { airframe: a, flight: f, sighting: s });
  }
  return [...out.values()];
}

export interface AircraftView {
  airframe: Airframe;
  registration: string | null;
  flights: Flight[];
  sightings: Sighting[];
  operatorId: string | null;
  first: string | null;
  last: string | null;
}

export function aircraftViews(store: Store): AircraftView[] {
  const byId = new Map<string, AircraftView>();
  for (const a of store.all("airframes")) byId.set(a.id, { airframe: a, registration: null, flights: [], sightings: [], operatorId: null, first: null, last: null });
  const touch = (v: AircraftView, d: string | null) => {
    if (!d) return;
    if (!v.first || d < v.first) v.first = d;
    if (!v.last || d > v.last) v.last = d;
  };
  for (const f of store.all("flights")) {
    const v = f.airframeId ? byId.get(f.airframeId) : undefined;
    if (!v) continue;
    v.flights.push(f);
    touch(v, flightDay(f));
  }
  for (const s of store.all("sightings")) {
    const v = s.airframeId ? byId.get(s.airframeId) : undefined;
    if (!v) continue;
    v.sightings.push(s);
    touch(v, s.seenOn);
  }
  for (const v of byId.values()) {
    // Latest registration and operator seen on the user's own records.
    const recs = [...v.flights.map((f) => ({ d: flightDay(f) ?? "", reg: f.registration, op: f.operatingAirlineId ?? f.airlineId })), ...v.sightings.map((s) => ({ d: s.seenOn ?? "", reg: s.registration, op: s.operatorId }))].sort((a, b) => a.d.localeCompare(b.d));
    const last = recs[recs.length - 1];
    v.registration = last?.reg ?? store.all("registration_periods").find((p) => p.airframeId === v.airframe.id)?.registration ?? null;
    v.operatorId = [...recs].reverse().find((r) => r.op)?.op ?? null;
  }
  return [...byId.values()];
}
