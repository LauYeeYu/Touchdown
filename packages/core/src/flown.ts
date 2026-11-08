// The distance a flight flew, along its recorded track (docs/23-tracks-and-maps.md, "Distance"): the flight's distance
// wherever its track's positions are in the store, and what route extension measures against the great circle. The
// same in the web app, the share page and the CLI. Nothing here is stored.

import { arrivalAirportId } from "./derive.ts";
import { haversineKm } from "./geo/index.ts";
import type { RefIndex } from "./ref/index.ts";
import type { Flight, TrackPoint } from "./schema/tables.ts";
import type { Store } from "./store.ts";
import { trackDistanceKm } from "./tracks.ts";

export interface FlownDistance {
  /** Along the airborne positions, from the first to the last, joined to the two airports where they are known, km. */
  km: number;
  /**
   * The track has a gap, or stops short of an airport, and that stretch counts as the great circle (the shortest it
   * could have been): the flight flew at least this far.
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

/** One flight's distance along its track's positions (in order), or null for fewer than two. */
export function flownDistance(f: Flight, points: TrackPoint[], ref: RefIndex): FlownDistance | null {
  if (points.length < 2) return null;
  let first = points.findIndex(airborne);
  let last = points.findLastIndex(airborne);
  if (first < 0 || last <= first) [first, last] = [0, points.length - 1];
  const path = points.slice(first, last + 1);
  const a = ref.airport(f.fromAirportId);
  const b = ref.airport(arrivalAirportId(f));
  const km = (a ? haversineKm(a, path[0]!) : 0) + trackDistanceKm(path) + (b ? haversineKm(path[path.length - 1]!, b) : 0);
  // An airport not known cannot be joined: the stretch to it is not counted.
  const short = !a || !b || haversineKm(a, points[0]!) > AIRPORT_KM || haversineKm(points[points.length - 1]!, b) > AIRPORT_KM;
  const gap = path.some((p, i) => i > 0 && p.t - path[i - 1]!.t > GAP_S && haversineKm(path[i - 1]!, p) > GAP_KM);
  return { km, minimum: short || gap };
}

const cache = new WeakMap<Store, { key: string; ref: RefIndex; map: Map<string, FlownDistance> }>();

/**
 * Each flight's distance flown, by flight id, for the flights with a recorded track whose positions are in this store.
 * Worked out again only when the flights, the tracks, their positions or the airports change.
 */
export function flownDistances(store: Store, ref: RefIndex): ReadonlyMap<string, FlownDistance> {
  const key = [store.revision("flights"), store.revision("tracks"), store.revision("track_points"), ref.airportsRevision].join("|");
  const hit = cache.get(store);
  if (hit && hit.key === key && hit.ref === ref) return hit.map;
  const tracks = new Map(store.all("tracks").map((t) => [t.id, t]));
  const points = new Map<string, TrackPoint[]>();
  for (const p of store.all("track_points")) {
    if (!tracks.has(p.trackId)) continue;
    const list = points.get(p.trackId);
    if (list) list.push(p);
    else points.set(p.trackId, [p]);
  }
  const map = new Map<string, FlownDistance>();
  for (const [id, t] of tracks) {
    const f = store.get("flights", t.flightId);
    const d = f && flownDistance(f, (points.get(id) ?? []).sort((x, y) => x.seq - y.seq), ref);
    if (d) map.set(f.id, d);
  }
  cache.set(store, { key, ref, map });
  return map;
}
