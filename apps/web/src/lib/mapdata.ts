// Turning flights and sightings into map marks.

import { haversineKm, simplifyTrack, type RefIndex, type Settings, type Sighting, type Store } from "@touchdown/core";
import type { MapFlight, MapSpot } from "../components/maps.tsx";
import { esc } from "../components/overlay.tsx";
import { dateOnly, dayShort, distance, plural, shortAirport } from "./format.ts";
import type { FlightView } from "./views.ts";
import { primaryCode, textCode } from "./codes.ts";

/** Recorded track coordinates per flight id. */
export function trackIndex(store: Store): Map<string, [number, number][]> {
  const byTrack = new Map<string, { seq: number; at: [number, number] }[]>();
  for (const p of store.all("track_points")) {
    const list = byTrack.get(p.trackId) ?? [];
    list.push({ seq: p.seq, at: [p.lon, p.lat] });
    byTrack.set(p.trackId, list);
  }
  const out = new Map<string, [number, number][]>();
  for (const t of store.all("tracks")) {
    const pts = (byTrack.get(t.id) ?? []).sort((a, b) => a.seq - b.seq).map((p) => p.at);
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

/**
 * Map marks for flights: the recorded track where there is one, else the great circle. A partial track is
 * joined to its airports with great-circle gaps, drawn dashed, so every route stays whole. Tracks are cut to
 * `trackPoints` points; a map of one flight keeps them all.
 */
export function mapFlights(views: FlightView[], ref: RefIndex, unit: Settings["distanceUnit"], bothAirframes: Set<string> = new Set(), store?: Store, trackPoints = OVERVIEW_TRACK_POINTS): MapFlight[] {
  const out: MapFlight[] = [];
  const tracks = store ? trackIndex(store) : new Map<string, [number, number][]>();
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

function overviewTrack(full: [number, number][] | undefined, from: [number, number], to: [number, number], points: number): Pick<MapFlight, "track" | "gaps"> {
  if (!full || full.length < 2) return { track: null, gaps: [] };
  const simple = full.length <= points ? full : simplifyTrack(full.map(([lon, lat]) => ({ lon, lat })), points).map((p) => [p.lon, p.lat] as [number, number]);
  const first = simple[0]!;
  const last = simple[simple.length - 1]!;
  const gaps: [number, number][][] = [];
  const km = (a: [number, number], b: [number, number]) => haversineKm({ lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] });
  if (km(from, first) > GAP_KM) gaps.push([from, first]);
  if (km(last, to) > GAP_KM) gaps.push([last, to]);
  return { track: simple, gaps };
}
