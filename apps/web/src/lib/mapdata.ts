// Turning flights and sightings into map marks.

import { haversineKm, simplifyTrack, type RefIndex, type Settings, type Sighting, type Store } from "@touchdown/core";
import type { MapFlight, MapSpot } from "../components/maps.tsx";
import { esc } from "../components/overlay.tsx";
import { dateOnly, dayShort, distance, plural, shortAirport } from "./format.ts";
import type { FlightView } from "./views.ts";
import { primaryCode, textCode } from "./codes.ts";

/** A recorded position: where, and when (Unix seconds). */
export interface TrackPoint {
  at: [number, number];
  t: number;
}

/** Recorded track positions per flight id, in order. */
export function trackIndex(store: Store): Map<string, TrackPoint[]> {
  const byTrack = new Map<string, { seq: number; at: [number, number]; t: number }[]>();
  for (const p of store.all("track_points")) {
    const list = byTrack.get(p.trackId) ?? [];
    list.push({ seq: p.seq, at: [p.lon, p.lat], t: p.t });
    byTrack.set(p.trackId, list);
  }
  const out = new Map<string, TrackPoint[]>();
  for (const t of store.all("tracks")) {
    const pts = (byTrack.get(t.id) ?? []).sort((a, b) => a.seq - b.seq).map(({ at, t }) => ({ at, t }));
    if (pts.length > 1) out.set(t.flightId, pts);
  }
  return out;
}

export interface TrackInfo {
  coverage: "complete" | "partial";
  provider: string | null;
}

/** Coverage and source of the recorded track per flight id. */
export function trackInfo(store: Store): Map<string, TrackInfo> {
  return new Map(store.all("tracks").map((t) => [t.flightId, { coverage: t.coverage ?? "complete", provider: t.provider }]));
}

// Overview maps draw many flights at a small scale; a few hundred points per track look the same.
const OVERVIEW_TRACK_POINTS = 400;
const GAP_KM = 30;
// Inside a track, a stretch with nothing received for this long and this far is a gap, drawn dashed. Stored tracks
// keep a point every few minutes at most, so only a gap in the recording is this long.
const GAP_INSIDE_S = 10 * 60;
const GAP_INSIDE_KM = 100;

/**
 * Map marks for flights: the recorded track where there is one, else the great circle. What a track does not record
 * (from the departure to its first point, gaps inside it, from its last point to the arrival) is drawn dashed, so
 * every route stays whole, as great circles. Tracks are cut to `trackPoints` points; a map of one flight keeps them all.
 */
export function mapFlights(views: FlightView[], ref: RefIndex, unit: Settings["distanceUnit"], bothAirframes: Set<string> = new Set(), store?: Store, trackPoints = OVERVIEW_TRACK_POINTS): MapFlight[] {
  const out: MapFlight[] = [];
  const tracks = store ? trackIndex(store) : new Map<string, TrackPoint[]>();
  for (const v of views) {
    const a = ref.airport(v.f.fromAirportId);
    const b = ref.airport(v.f.divertedToAirportId ?? v.f.toAirportId);
    if (!a || !b) continue;
    out.push({
      id: v.f.id,
      from: [a.lon, a.lat],
      to: [b.lon, b.lat],
      // Map labels have room for one code; the tooltip below shows them as text.
      fromCode: primaryCode(a),
      toCode: primaryCode(b),
      fromId: a.id,
      toId: b.id,
      fromName: shortAirport(a.id, ref),
      toName: shortAirport(b.id, ref),
      route: v.route ?? "",
      both: !!v.f.airframeId && bothAirframes.has(v.f.airframeId),
      tip: `<strong>${esc(v.f.flightNumber ?? "Flight")} · ${esc(v.fromCode)} → ${esc(v.toCode)}</strong><br><span class="muted">${v.day ? `${dayShort(v.day)} ${v.day.slice(0, 4)}` : "No date"}${v.km ? ` · ${distance(v.km, unit)}` : ""}</span>`,
      ...overviewTrack(tracks.get(v.f.id), [a.lon, a.lat], [b.lon, b.lat], trackPoints),
    });
  }
  return out;
}

export function mapSpots(sightings: Sighting[], ref: RefIndex, bothAirframes: Set<string> = new Set()): MapSpot[] {
  const byAp = new Map<string, { airframes: Set<string>; days: Set<string>; last: string; both: boolean }>();
  for (const s of sightings) {
    if (!s.airportId) continue;
    const v = byAp.get(s.airportId) ?? { airframes: new Set(), days: new Set(), last: "", both: false };
    if (s.airframeId) v.airframes.add(s.airframeId);
    if (s.seenOn) {
      v.days.add(s.seenOn);
      if (s.seenOn > v.last) v.last = s.seenOn;
    }
    if (s.airframeId && bothAirframes.has(s.airframeId)) v.both = true;
    byAp.set(s.airportId, v);
  }
  const out: MapSpot[] = [];
  for (const [id, v] of byAp) {
    const a = ref.airport(id);
    if (!a) continue;
    const code = primaryCode(a);
    const name = shortAirport(id, ref);
    out.push({
      airportId: id,
      name,
      code,
      at: [a.lon, a.lat],
      aircraft: v.airframes.size,
      both: v.both,
      label: `${name}: ${plural(v.airframes.size, "aircraft", "aircraft")} seen`,
      tip: `<strong>${esc(name)} (${esc(textCode(a))})</strong><br><span class="muted">${plural(v.airframes.size, "aircraft", "aircraft")} seen on ${plural(v.days.size, "day")}${v.last ? ` · last ${dateOnly(v.last)}` : ""} · click for the airport page</span>`,
    });
  }
  return out;
}

const km = (a: [number, number], b: [number, number]) => haversineKm({ lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] });

/** The recorded stretches of a track (split at its gaps) and the gaps between them. */
export function trackRuns(full: TrackPoint[]): { runs: [number, number][][]; gaps: [[number, number], [number, number]][] } {
  const runs: [number, number][][] = [];
  const gaps: [[number, number], [number, number]][] = [];
  let run: [number, number][] = [full[0]!.at];
  for (let i = 1; i < full.length; i++) {
    const a = full[i - 1]!;
    const b = full[i]!;
    if (b.t - a.t > GAP_INSIDE_S && km(a.at, b.at) > GAP_INSIDE_KM) {
      runs.push(run);
      gaps.push([a.at, b.at]);
      run = [b.at];
    } else run.push(b.at);
  }
  runs.push(run);
  return { runs, gaps };
}

function overviewTrack(full: TrackPoint[] | undefined, from: [number, number], to: [number, number], points: number): Pick<MapFlight, "track" | "line" | "gaps"> {
  if (!full || full.length < 2) return { track: null, line: [[from, to]], gaps: [] };
  const split = trackRuns(full);
  // Each recorded stretch gets its share of the points.
  const runs = split.runs.map((r) => {
    const share = Math.max(2, Math.round((points * r.length) / full.length));
    return r.length <= share ? r : simplifyTrack(r.map(([lon, lat]) => ({ lon, lat })), share).map((p) => [p.lon, p.lat] as [number, number]);
  });
  const first = runs[0]![0]!;
  const lastRun = runs[runs.length - 1]!;
  const last = lastRun[lastRun.length - 1]!;
  const gaps: [number, number][][] = [];
  if (km(from, first) > GAP_KM) gaps.push([from, first]);
  gaps.push(...split.gaps);
  if (km(last, to) > GAP_KM) gaps.push([last, to]);
  return { track: runs.flat(), line: runs.filter((r) => r.length > 1), gaps };
}
