// Recorded tracks (docs/23-tracks-and-maps.md): read a track file, match it to a flight, simplify it to at
// most 2,000 points and store it in place of the great circle.

import type { RefIndex } from "./ref/index.ts";
import type { Flight } from "./schema/tables.ts";
import type { Store } from "./store.ts";
import { readCsv } from "./import/read.ts";
import { haversineKm, type LatLon } from "./geo/index.ts";
import { addDays, instant, toUtcIso } from "./time/index.ts";
import { flightDay, arrivalAirportId } from "./derive.ts";

export interface TrackPointInput extends LatLon {
  t: number; // Unix seconds, UTC
  altitudeFt: number | null;
  groundSpeedKt: number | null;
  headingDeg: number | null;
}

export const MAX_TRACK_POINTS = 2000;
const NEAR_KM = 30;
const MAX_SPEED_KT = 1200;
const MIN_PARTIAL_POINTS = 20;
const MIN_PARTIAL_SHARE = 0.25;

/** Flightradar24 playback CSV: Timestamp, UTC, Callsign, Position ("lat,lon"), Altitude, Speed, Direction. */
export function parseTrackCsv(text: string): TrackPointInput[] {
  const sheet = readCsv(text);
  const col = (n: string) => sheet.header.findIndex((h) => h.toLowerCase() === n);
  const [ti, pi, ai, si, di] = ["timestamp", "position", "altitude", "speed", "direction"].map(col) as [number, number, number, number, number];
  if (ti < 0 || pi < 0) return [];
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  const out: TrackPointInput[] = [];
  for (const r of sheet.rows) {
    const t = num(r[ti]);
    const [lat, lon] = String(r[pi] ?? "").split(",").map(Number);
    if (t === null || !Number.isFinite(t) || !Number.isFinite(lat!) || !Number.isFinite(lon!)) continue;
    const alt = ai >= 0 ? num(r[ai]) : null;
    const gs = si >= 0 ? num(r[si]) : null;
    const hd = di >= 0 ? num(r[di]) : null;
    out.push({ t, lat: lat!, lon: lon!, altitudeFt: alt === null ? null : Math.round(alt), groundSpeedKt: gs === null ? null : Math.round(gs), headingDeg: hd === null ? null : Math.round(hd) });
  }
  out.sort((a, b) => a.t - b.t);
  return dropJumps(out);
}

/** Drop points that would need an impossible speed from the previous kept point (bad data). */
function dropJumps(points: TrackPointInput[]): TrackPointInput[] {
  const out: TrackPointInput[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev) {
      const hours = (p.t - prev.t) / 3600;
      if (hours <= 0) continue;
      const kt = haversineKm(prev, p) / 1.852 / hours;
      if (kt > MAX_SPEED_KT && hours < 1) continue;
    }
    out.push(p);
  }
  return out;
}

export function trackDistanceKm(points: LatLon[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversineKm(points[i - 1]!, points[i]!);
  return d;
}

/** Visvalingam–Whyatt simplification to at most `max` points, keeping the first and last. */
export function simplifyTrack<T extends LatLon>(points: T[], max = MAX_TRACK_POINTS): T[] {
  if (points.length <= max) return points;
  const n = points.length;
  const prev = Array.from({ length: n }, (_, i) => i - 1);
  const next = Array.from({ length: n }, (_, i) => i + 1);
  const removed = new Uint8Array(n);
  const area = (i: number) => {
    const a = points[prev[i]!]!;
    const b = points[i]!;
    const c = points[next[i]!]!;
    // Planar triangle area in degrees, with longitude scaled by latitude; enough to rank points.
    const k = Math.cos((b.lat * Math.PI) / 180);
    return Math.abs((a.lon - c.lon) * k * (b.lat - a.lat) - (a.lon - b.lon) * k * (c.lat - a.lat)) / 2;
  };
  // Binary heap of [area, index].
  const heap: [number, number][] = [];
  const push = (e: [number, number]) => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]![0] <= heap[i]![0]) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };
  const current = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {
    current[i] = area(i);
    push([current[i]!, i]);
  }
  let left = n;
  while (left > max && heap.length) {
    const [a, i] = pop();
    if (removed[i] || a !== current[i]) continue;
    removed[i] = 1;
    left--;
    const p = prev[i]!;
    const q = next[i]!;
    next[p] = q;
    prev[q] = p;
    for (const j of [p, q]) {
      if (j <= 0 || j >= n - 1) continue;
      current[j] = Math.max(area(j), a);
      push([current[j]!, j]);
    }
  }
  return points.filter((_, i) => !removed[i]);
}

export interface TrackFileName {
  flightNumber: string;
  from: string;
  to: string;
  date: string; // YYYY-MM-DD
}

/** FR24 download names: <flight>_<from>_<to>_<YYYYMMDD>_<id>.csv */
export function parseTrackFileName(name: string): TrackFileName | null {
  const m = /([A-Z0-9]{2,8})_([A-Z]{3})_([A-Z]{3})_(\d{4})(\d{2})(\d{2})/.exec(name.toUpperCase());
  if (!m) return null;
  return { flightNumber: m[1]!, from: m[2]!, to: m[3]!, date: `${m[4]}-${m[5]}-${m[6]}` };
}

export interface TrackMatch {
  flight: Flight;
  coverage: "complete" | "partial";
  startKm: number | null; // distance of the first point from the departure airport
  endKm: number | null;
}

/** Find the flight a track belongs to: by file name when it has one, else by time and airports. */
export function matchTrack(points: TrackPointInput[], flights: Flight[], ref: RefIndex, fileName?: string): TrackMatch | null {
  if (!points.length) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const named = fileName ? parseTrackFileName(fileName) : null;
  const scored: { f: Flight; score: number }[] = [];
  for (const f of flights) {
    const a = ref.airport(f.fromAirportId);
    const b = ref.airport(arrivalAirportId(f));
    const day = f.scheduledDate ?? flightDay(f);
    let score = 0;
    if (named) {
      const codeOk = (a?.iata === named.from || a?.icao === named.from) && (b?.iata === named.to || b?.icao === named.to);
      const dateOk = !!day && [day, addDays(day, 1), addDays(day, -1)].includes(named.date);
      const fnOk = (f.flightNumber ?? "").toUpperCase() === named.flightNumber;
      if (codeOk && dateOk) score += fnOk ? 3 : 2;
    }
    const t0 = instant(f.takeoffAt);
    const t1 = instant(f.landingAt);
    if (t0 !== null && t1 !== null) {
      const overlap = Math.min(t1, last.t * 1000) - Math.max(t0, first.t * 1000);
      if (overlap > 0) score += 2;
    }
    if (a && b && haversineKm(a, first) < 400 && haversineKm(b, last) < 400) score += 1;
    if (score >= 2) scored.push({ f, score });
  }
  scored.sort((x, y) => y.score - x.score);
  const best = scored[0];
  if (!best) return null;
  const a = ref.airport(best.f.fromAirportId);
  const b = ref.airport(arrivalAirportId(best.f));
  const startKm = a ? haversineKm(a, first) : null;
  const endKm = b ? haversineKm(b, last) : null;
  const coverage = startKm !== null && endKm !== null && startKm < NEAR_KM && endKm < NEAR_KM ? "complete" : "partial";
  // A fragment (a few points near one end) would draw a stub instead of the route: keep the great circle.
  if (coverage === "partial") {
    const gc = a && b ? haversineKm(a, b) : null;
    if (points.length < MIN_PARTIAL_POINTS || (gc && trackDistanceKm(points) < gc * MIN_PARTIAL_SHARE)) return null;
  }
  return { flight: best.f, coverage, startKm, endKm };
}

export interface AttachOptions {
  provider: "fr24_csv" | "fr24_kml" | "adsblol" | "aeroapi" | "gpx" | "other";
  attribution: string;
  coverage: "complete" | "partial";
  now?: number;
}

/** Store a track for a flight, replacing any earlier one. Returns the track id. */
export function attachTrack(store: Store, flightId: string, points: TrackPointInput[], opts: AttachOptions): string {
  return store.batch(() => {
    for (const old of store.all("tracks").filter((t) => t.flightId === flightId)) {
      const keys = store.all("track_points").filter((p) => p.trackId === old.id).map((p) => `${p.trackId}|${p.seq}`);
      store.purge("track_points", keys);
      store.remove("tracks", old.id);
    }
    const simple = simplifyTrack(points);
    const track = store.insert("tracks", {
      flightId,
      provider: opts.provider,
      coverage: opts.coverage,
      pointCount: simple.length,
      firstPointAt: toUtcIso(simple[0]!.t * 1000),
      lastPointAt: toUtcIso(simple[simple.length - 1]!.t * 1000),
      distanceKm: Math.round(trackDistanceKm(points) * 10) / 10,
      attribution: opts.attribution,
      importedAt: toUtcIso(opts.now ?? Date.now()),
    });
    store.putRaw(
      "track_points",
      simple.map((p, seq) => ({ trackId: track.id, seq, t: p.t, lat: p.lat, lon: p.lon, altitudeFt: p.altitudeFt, groundSpeedKt: p.groundSpeedKt, headingDeg: p.headingDeg })),
    );
    return track.id;
  });
}

/** Rank tracks for one flight: complete beats partial, then more points. */
export function betterTrack(a: { coverage: string; points: number }, b: { coverage: string; points: number }): boolean {
  if (a.coverage !== b.coverage) return a.coverage === "complete";
  return a.points > b.points;
}
