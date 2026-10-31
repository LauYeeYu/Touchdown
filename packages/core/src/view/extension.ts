// Route extension: the distance a flight flew beyond the great circle between its airports, along its recorded
// track (docs/23-tracks-and-maps.md, "Route extension"). The same in the web app (a flight's page, Statistics) and the
// CLI. Nothing here is stored.

import { arrivalAirportId, routeKey } from "../derive.ts";
import { haversineKm } from "../geo/index.ts";
import type { RefIndex } from "../ref/index.ts";
import type { Flight, TrackPoint } from "../schema/tables.ts";
import type { Store } from "../store.ts";
import { trackDistanceKm } from "../tracks.ts";

export interface RouteExtension {
  flightId: string;
  /** The airborne path, from the first position to the last, joined to the two airports, km. */
  flownKm: number;
  /** Between the two airports, km. */
  greatCircleKm: number;
  /** flownKm − greatCircleKm. */
  extraKm: number;
  /** extraKm against greatCircleKm, in percent. */
  percent: number;
  /**
   * The track has a gap, or stops short of an airport, and the missing stretch counts as the great circle: the
   * flight flew at least this much further.
   */
  minimum: boolean;
}

/** On the ground below this speed: taxiing is not part of the route. Without a speed, above the ground is airborne. */
const AIRBORNE_KT = 60;
/** As the maps split a track: nothing received for over 10 minutes and 100 km is a gap. */
const GAP_S = 10 * 60;
const GAP_KM = 100;
/** A track that starts or ends further than this from its airport stops short of it. */
const AIRPORT_KM = 30;

const airborne = (p: TrackPoint) => (p.groundSpeedKt !== null && p.groundSpeedKt !== undefined ? p.groundSpeedKt >= AIRBORNE_KT : (p.altitudeFt ?? 0) > 0);

function extensionOf(f: Flight, points: TrackPoint[], ref: RefIndex): RouteExtension | null {
  const a = ref.airport(f.fromAirportId);
  const b = ref.airport(arrivalAirportId(f));
  if (!a || !b || points.length < 2) return null;
  const greatCircleKm = haversineKm(a, b);
  if (greatCircleKm < 1) return null;
  let first = points.findIndex(airborne);
  let last = points.findLastIndex(airborne);
  if (first < 0 || last <= first) [first, last] = [0, points.length - 1];
  const path = points.slice(first, last + 1);
  const flownKm = haversineKm(a, path[0]!) + trackDistanceKm(path) + haversineKm(path[path.length - 1]!, b);
  const short = haversineKm(a, points[0]!) > AIRPORT_KM || haversineKm(points[points.length - 1]!, b) > AIRPORT_KM;
  const minimum = short || path.some((p, i) => i > 0 && p.t - path[i - 1]!.t > GAP_S && haversineKm(path[i - 1]!, p) > GAP_KM);
  const extraKm = Math.max(0, flownKm - greatCircleKm);
  return { flightId: f.id, flownKm, greatCircleKm, extraKm, percent: (extraKm / greatCircleKm) * 100, minimum };
}

/**
 * Each flight's route extension, by flight id, for the flights given (else every flight) that have a recorded track
 * whose positions are in this store. A stretch the track does not record counts as the great circle, a minimum.
 */
export function routeExtensions(store: Store, ref: RefIndex, flights?: Flight[]): Map<string, RouteExtension> {
  const wanted = flights ? new Set(flights.map((f) => f.id)) : null;
  const tracks = new Map(store.all("tracks").filter((t) => !wanted || wanted.has(t.flightId)).map((t) => [t.id, t]));
  const points = new Map<string, TrackPoint[]>();
  for (const p of store.all("track_points")) {
    if (!tracks.has(p.trackId)) continue;
    const list = points.get(p.trackId);
    if (list) list.push(p);
    else points.set(p.trackId, [p]);
  }
  const out = new Map<string, RouteExtension>();
  for (const [id, t] of tracks) {
    const f = store.get("flights", t.flightId);
    const e = f && extensionOf(f, (points.get(id) ?? []).sort((x, y) => x.seq - y.seq), ref);
    if (e) out.set(f.id, e);
  }
  return out;
}

/** One flight's route extension, or null when it has no recorded track, or its positions are not here. */
export function routeExtension(store: Store, ref: RefIndex, f: Flight): RouteExtension | null {
  return routeExtensions(store, ref, [f]).get(f.id) ?? null;
}

export interface RouteExtensionByRoute {
  /** As the Routes ranking keys a route, both ways as one: "BOS-JFK". */
  route: string;
  /** Flights on it with a route extension. */
  flights: number;
  flownKm: number;
  greatCircleKm: number;
  extraKm: number;
  /** The extra distance over all its flights against their great circles, in percent. */
  percent: number;
  minimum: boolean;
}

/** Routes with a route extension for at least `least` of their flights, furthest off the great circle first. */
export function routeExtensionByRoute(flights: Flight[], extensions: Map<string, RouteExtension>, ref: RefIndex, least = 2): RouteExtensionByRoute[] {
  const by = new Map<string, RouteExtensionByRoute>();
  for (const f of flights) {
    const e = extensions.get(f.id);
    const route = routeKey(f, ref);
    if (!e || !route) continue;
    const r = by.get(route) ?? { route, flights: 0, flownKm: 0, greatCircleKm: 0, extraKm: 0, percent: 0, minimum: false };
    r.flights++;
    r.flownKm += e.flownKm;
    r.greatCircleKm += e.greatCircleKm;
    r.extraKm += e.extraKm;
    r.minimum ||= e.minimum;
    by.set(route, r);
  }
  return [...by.values()]
    .filter((r) => r.flights >= least)
    .map((r) => ({ ...r, percent: (r.extraKm / r.greatCircleKm) * 100 }))
    .sort((x, y) => y.percent - x.percent || x.route.localeCompare(y.route));
}

/** "+13%", "+8.4%", "+8%", "under +0.1%": whole percents from 10, one decimal below. "At least" is for the caller to add. */
export function extensionPercent(percent: number): string {
  if (percent < 0.05) return "under +0.1%";
  return `+${percent >= 10 ? Math.round(percent) : Number(percent.toFixed(1))}%`;
}
