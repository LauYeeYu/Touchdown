// Recorded tracks (docs/23-tracks-and-maps.md): read a track file (Flightradar24 CSV or KML, any KML or GPX
// with times), match it to a flight or check it against the one the user chose, simplify it to at most 2,000 points
// and store it in place of the great circle.

import type { RefIndex } from "./ref/index.ts";
import type { Flight } from "./schema/tables.ts";
import type { Store } from "./store.ts";
import { readCsv } from "./import/read.ts";
import { haversineKm, type LatLon } from "./geo/index.ts";
import { addDays, instant, toUtcIso } from "./time/index.ts";
import { flightDay, arrivalAirportId } from "./derive.ts";
import { parseFlightNumber } from "./normalise/flight.ts";

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
  return tidy(out);
}

/** In time order, one point per second, impossible jumps dropped. */
function tidy(points: TrackPointInput[]): TrackPointInput[] {
  const sorted = [...points].sort((a, b) => a.t - b.t).filter((p, i, list) => i === 0 || p.t !== list[i - 1]!.t);
  return dropJumps(sorted);
}

const M_TO_FT = 3.28084;
const MS_TO_KT = 1.943844;

const tagValue = (body: string, tag: string) => new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>\\s*([^<]*?)\\s*</(?:[\\w-]+:)?${tag}>`).exec(body)?.[1] ?? null;
const numberIn = (text: string | null) => (text === null || text === "" ? null : Number(text.replace(/,/g, "")));
const roundOrNull = (n: number | null) => (n === null || !Number.isFinite(n) ? null : Math.round(n));

function pointAt(when: string | null, lon: number, lat: number, altitudeFt: number | null, groundSpeedKt: number | null, headingDeg: number | null): TrackPointInput | null {
  const ms = when ? Date.parse(when) : NaN;
  if (!Number.isFinite(ms) || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { t: Math.round(ms / 1000), lat, lon, altitudeFt: roundOrNull(altitudeFt), groundSpeedKt: roundOrNull(groundSpeedKt), headingDeg: roundOrNull(headingDeg) };
}

/** Altitude, speed and heading from a Flightradar24 trail point's description ("Altitude: 37,000 ft"). */
function described(body: string): { altitudeFt: number | null; groundSpeedKt: number | null; headingDeg: number | null } {
  const raw = /<description\b[^>]*>([\s\S]*?)<\/description>/.exec(body)?.[1] ?? "";
  const text = raw.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ");
  const grab = (re: RegExp) => numberIn(re.exec(text)?.[1] ?? null);
  return { altitudeFt: grab(/Altitude\D{0,20}?([\d,.]+)\s*ft/i), groundSpeedKt: grab(/Speed\D{0,20}?([\d,.]+)\s*(?:kt|kts|knots)\b/i), headingDeg: grab(/Heading\D{0,20}?([\d,.]+)/i) };
}

/**
 * KML: Flightradar24's download (a trail of placemarks, each with a time and a point, altitude and speed in its
 * description), or any KML with a gx:Track. A line without times says nothing about when, so it is not read.
 */
export function parseTrackKml(text: string): TrackPointInput[] {
  const out: TrackPointInput[] = [];
  for (const m of text.matchAll(/<gx:Track\b[^>]*>([\s\S]*?)<\/gx:Track>/g)) {
    const whens = [...m[1]!.matchAll(/<when>\s*([^<]*?)\s*<\/when>/g)].map((x) => x[1]!);
    const coords = [...m[1]!.matchAll(/<gx:coord>\s*([^<]*?)\s*<\/gx:coord>/g)].map((x) => x[1]!.split(/\s+/).map(Number));
    for (let i = 0; i < Math.min(whens.length, coords.length); i++) {
      const [lon, lat, altM] = coords[i]!;
      const p = pointAt(whens[i]!, lon!, lat!, altM === undefined ? null : altM * M_TO_FT, null, null);
      if (p) out.push(p);
    }
  }
  for (const m of text.matchAll(/<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/g)) {
    const body = m[1]!;
    const point = /<Point\b[^>]*>([\s\S]*?)<\/Point>/.exec(body)?.[1];
    const when = tagValue(body, "when");
    if (!point || !when) continue;
    const [lon, lat, altM] = (tagValue(point, "coordinates") ?? "").split(",").map(Number);
    const d = described(body);
    const p = pointAt(when, lon!, lat!, d.altitudeFt ?? (altM === undefined || !Number.isFinite(altM) ? null : altM * M_TO_FT), d.groundSpeedKt, d.headingDeg);
    if (p) out.push(p);
  }
  return tidy(out);
}

/** GPX: track or route points with a time; elevation in metres, speed in metres a second when given. */
export function parseTrackGpx(text: string): TrackPointInput[] {
  const out: TrackPointInput[] = [];
  for (const m of text.matchAll(/<(trkpt|rtept)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const attr = (name: string) => Number(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`).exec(m[2]!)?.[1]);
    const body = m[3]!;
    const ele = numberIn(tagValue(body, "ele"));
    const speed = numberIn(tagValue(body, "speed"));
    const p = pointAt(tagValue(body, "time"), attr("lon"), attr("lat"), ele === null ? null : ele * M_TO_FT, speed === null ? null : speed * MS_TO_KT, numberIn(tagValue(body, "course")));
    if (p) out.push(p);
  }
  return tidy(out);
}

export const FR24_ATTRIBUTION = "Track data: Flightradar24, downloaded by the user";
export const ADSBLOL_ATTRIBUTION = "Track data: adsb.lol (ODbL)";

/** A track file as read: its points, where they come from, and the credit maps show. */
export interface TrackFile {
  points: TrackPointInput[];
  provider: AttachOptions["provider"];
  attribution: string;
}

/** Read a track file the user gives for a flight: a Flightradar24 CSV or KML, or any KML or GPX with times. */
export function readTrackFile(name: string, text: string): TrackFile | { error: string } {
  const lower = name.toLowerCase();
  const head = text.slice(0, 4000).toLowerCase();
  let file: TrackFile;
  if (lower.endsWith(".gpx") || head.includes("<gpx")) file = { points: parseTrackGpx(text), provider: "gpx", attribution: "Track data: a GPX file uploaded by the user" };
  else if (lower.endsWith(".kml") || head.includes("<kml")) {
    const fr24 = /flightradar24/i.test(text.slice(0, 50_000));
    file = { points: parseTrackKml(text), provider: fr24 ? "fr24_kml" : "other", attribution: fr24 ? FR24_ATTRIBUTION : "Track data: a KML file uploaded by the user" };
  } else if (lower.endsWith(".csv") || head.includes("timestamp")) {
    file = { points: parseTrackCsv(text), provider: "fr24_csv", attribution: FR24_ATTRIBUTION };
    if (!file.points.length) return { error: "This CSV is not a Flightradar24 track: it needs Timestamp and Position columns." };
  } else return { error: "Give a Flightradar24 CSV or KML file, or a KML or GPX file whose points have times." };
  if (file.points.length < 2) return { error: "The file has no track with times: it needs at least two points, each with its time." };
  return file;
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

export type TrackFit = { coverage: "complete" | "partial"; startKm: number | null; endKm: number | null } | { problem: string };

const hhmm = (t: number) => toUtcIso(t * 1000).slice(11, 16);

/**
 * Whether a track the user gives belongs to this flight: its times fall on the flight (between takeoff and landing
 * when both are known, else on the flight's day, give or take one) and it runs from the departure towards the
 * arrival. Complete when it starts and ends at the airports; a fragment that would draw a stub is refused.
 */
/** How far a track may lie outside the flight's logged times and still be the flight: the times in a log are often the timetable's, and flights run late. */
export const TRACK_TIME_SLACK_MS = 3 * 3600_000;

export function fitTrack(points: TrackPointInput[], flight: Flight, ref: RefIndex, slackMs = TRACK_TIME_SLACK_MS): TrackFit {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const t0 = instant(flight.takeoffAt);
  const t1 = instant(flight.landingAt);
  const day = flightDay(flight);
  const trackDay = toUtcIso(first.t * 1000).slice(0, 10);
  if (t0 !== null && t1 !== null) {
    // The track must overlap the flight's times, widened by `slackMs` on each side for a delay or a timetable time.
    if (Math.min(t1 + slackMs, last.t * 1000) <= Math.max(t0 - slackMs, first.t * 1000)) {
      return { problem: `The track runs from ${trackDay} ${hhmm(first.t)} to ${hhmm(last.t)} UTC, outside this flight (takeoff ${toUtcIso(t0).slice(0, 16).replace("T", " ")} UTC).` };
    }
  } else if (day && ![day, addDays(day, -1), addDays(day, 1)].includes(trackDay)) {
    return { problem: `The track is from ${trackDay}, but this flight is on ${day}.` };
  }
  const a = ref.airport(flight.fromAirportId);
  const b = ref.airport(arrivalAirportId(flight));
  if (!a || !b) return { coverage: "partial", startKm: null, endKm: null };
  const code = (x: typeof a) => x.iata ?? x.icao ?? x.name;
  const startKm = haversineKm(a, first);
  const endKm = haversineKm(b, last);
  // It goes the flight's way: it ends nearer the arrival than it started, and starts nearer the departure than it
  // ended. A partial track that stops over an ocean still does.
  const towards = a.id === b.id || (endKm < haversineKm(b, first) && startKm < haversineKm(a, last));
  if (!towards) return { problem: `The track does not run from ${code(a)} to ${code(b)}: it starts ${Math.round(startKm)} km from ${code(a)} and ends ${Math.round(endKm)} km from ${code(b)}.` };
  const coverage = startKm < NEAR_KM && endKm < NEAR_KM ? "complete" : "partial";
  if (coverage === "partial") {
    const gc = haversineKm(a, b);
    const km = trackDistanceKm(points);
    if (points.length < MIN_PARTIAL_POINTS || (gc && km < gc * MIN_PARTIAL_SHARE)) {
      return { problem: `The track covers too little of the flight to draw (${Math.round(km)} of ${Math.round(gc)} km); the great circle stays.` };
    }
  }
  return { coverage, startKm, endKm };
}

/** Remove a flight's recorded track and its points; the flight goes back to the great circle. */
export function removeTrack(store: Store, flightId: string): boolean {
  return store.batch(() => {
    let removed = false;
    for (const old of store.all("tracks").filter((t) => t.flightId === flightId)) {
      const keys = store.all("track_points").filter((p) => p.trackId === old.id).map((p) => `${p.trackId}|${p.seq}`);
      store.purge("track_points", keys);
      store.remove("tracks", old.id);
      removed = true;
    }
    return removed;
  });
}

export interface AttachOptions {
  provider: "fr24_csv" | "fr24_kml" | "adsblol" | "aeroapi" | "gpx" | "other";
  attribution: string;
  coverage: "complete" | "partial";
  /** The distance along the whole track when `points` were simplified before. */
  distanceKm?: number;
  now?: number;
}

/** Store a track for a flight, replacing any earlier one. Returns the track id. */
export function attachTrack(store: Store, flightId: string, points: TrackPointInput[], opts: AttachOptions): string {
  return store.batch(() => {
    removeTrack(store, flightId);
    const simple = simplifyTrack(points);
    const track = store.insert("tracks", {
      flightId,
      provider: opts.provider,
      coverage: opts.coverage,
      pointCount: simple.length,
      firstPointAt: toUtcIso(simple[0]!.t * 1000),
      lastPointAt: toUtcIso(simple[simple.length - 1]!.t * 1000),
      distanceKm: Math.round((opts.distanceKm ?? trackDistanceKm(points)) * 10) / 10,
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

/** One aircraft's day in adsb.lol's history (readsb's trace_full file): seconds after `timestamp`, then the fix. */
export interface ReadsbTrace {
  icao?: string;
  timestamp: number;
  trace: unknown[][];
}

interface Fix extends TrackPointInput {
  ground: boolean;
  newLeg: boolean;
  /** The callsign the aircraft was transmitting, as readsb last recorded it ("DLH400"). */
  callsign: string | null;
}

const STOP_KT = 150;
const LEG_GAP_S = 30 * 60;
/** How far a leg flown under the flight's own callsign may lie outside the logged times: only another day's flight of the same number is ruled out. */
const CALLSIGN_SLACK_MS = 12 * 3600_000;

/** A readsb trace's fixes: [seconds, lat, lon, altitude ft or "ground", ground speed, track, flags, vertical rate, aircraft, …]. */
export function readsbFixes(trace: ReadsbTrace): Fix[] {
  const out: Fix[] = [];
  let callsign: string | null = null;
  for (const p of trace.trace ?? []) {
    const [dt, lat, lon, alt, gs, track, flags, , aircraft] = p as [number, number, number, number | "ground" | null, number | null, number | null, number | null, unknown, { flight?: unknown } | null | undefined];
    if (typeof dt !== "number" || typeof lat !== "number" || typeof lon !== "number") continue;
    // The aircraft's details come with the first fix and again whenever they change.
    if (aircraft && typeof aircraft === "object" && typeof aircraft.flight === "string") callsign = aircraft.flight.trim().toUpperCase() || null;
    const ground = alt === "ground";
    out.push({ t: Math.round(trace.timestamp + dt), lat, lon, altitudeFt: ground ? 0 : typeof alt === "number" ? Math.round(alt) : null, groundSpeedKt: typeof gs === "number" ? Math.round(gs) : null, headingDeg: typeof track === "number" ? Math.round(track) : null, ground, newLeg: typeof flags === "number" && (flags & 2) === 2, callsign });
  }
  return out;
}

/** A callsign as the airline's ICAO code and the flight's number without leading zeros: "DLH0400" → "DLH400"; null when it is not of that form. */
export function numericCallsign(callsign: string | null | undefined): string | null {
  const m = /^([A-Z]{3})0*(\d{1,4})$/.exec((callsign ?? "").trim().toUpperCase());
  return m ? `${m[1]}${m[2]}` : null;
}

/** The callsign the flight is expected to fly under, "DLH400" for LH400 by Lufthansa; null when the airline's ICAO code or the number is unknown. */
export function expectedCallsign(flight: Flight, ref: RefIndex): string | null {
  const parsed = parseFlightNumber(flight.flightNumber);
  if (!parsed) return null;
  const airline = ref.operator(flight.airlineId) ?? ref.operatorByCode(parsed.designator, flightDay(flight));
  const icao = airline?.icao ?? (parsed.designator.length === 3 ? parsed.designator : null);
  return icao ? `${icao}${parsed.number}` : null;
}

export interface ReadsbMatch {
  points: TrackPointInput[];
  coverage: "complete" | "partial";
  /** The callsign the leg was flown under, when the trace has one. */
  callsign: string | null;
  /** Minutes from the flight's logged takeoff to the leg's first fix when the leg lies outside the logged times (a delay, or a wrong time in the log); null when it overlaps them or the times are not known. */
  offsetMin: number | null;
}

/**
 * The flight in an aircraft's day traces (docs/23, "Matching an adsb.lol trace to a flight"). The fixes are cut into
 * legs where the aircraft was on the ground, where readsb marks a new leg, or at a gap the aircraft could not have
 * flown through (it stopped somewhere); a gap over an ocean, flown at speed, stays inside the leg. Each leg is checked
 * as a file is (fitTrack), allowing three hours around the logged times for a delay or a timetable time, and twelve
 * when the leg was flown under the flight's own callsign. A leg under that callsign wins, then a complete one, then
 * the one nearest the logged times (for partial legs, the one with the most points).
 */
export function trackFromReadsb(traces: ReadsbTrace[], flight: Flight, ref: RefIndex): ReadsbMatch | { problem: string } {
  const fixes = traces.flatMap(readsbFixes).sort((a, b) => a.t - b.t).filter((p, i, list) => i === 0 || p.t !== list[i - 1]!.t);
  if (fixes.length < 2) return { problem: "The aircraft has no positions that day." };
  const legs: Fix[][] = [];
  let leg: Fix[] = [];
  const close = () => {
    // A leg is the time in the air, with the last fix on the ground before it and the first after it.
    const air = leg.map((p, i) => (p.ground ? -1 : i)).filter((i) => i >= 0);
    if (air.length) legs.push(leg.slice(Math.max(0, air[0]! - 1), Math.min(leg.length, air[air.length - 1]! + 2)));
    leg = [];
  };
  for (const p of fixes) {
    const prev = leg[leg.length - 1];
    if (prev) {
      const gap = p.t - prev.t;
      const stopped = gap > LEG_GAP_S && haversineKm(prev, p) / 1.852 / (gap / 3600) < STOP_KT;
      const landed = prev.ground && !p.ground && leg.some((x) => !x.ground);
      if (p.newLeg || stopped || landed) close();
    }
    leg.push(p);
  }
  close();
  const t0 = instant(flight.takeoffAt);
  const t1 = instant(flight.landingAt);
  const wanted = expectedCallsign(flight, ref);
  type Candidate = ReadsbMatch & { byCallsign: boolean; awayMs: number };
  const better = (a: Candidate, b: Candidate) => {
    if (a.byCallsign !== b.byCallsign) return a.byCallsign;
    if (a.coverage !== b.coverage) return a.coverage === "complete";
    if (a.coverage === "partial" && a.points.length !== b.points.length) return a.points.length > b.points.length;
    return a.awayMs < b.awayMs;
  };
  let best: Candidate | null = null;
  let problem: string | null = null;
  let nearest = Infinity;
  for (const l of legs) {
    if (l.length < 2) continue;
    const points = dropJumps(l.map(({ ground: _g, newLeg: _n, callsign: _c, ...p }) => p));
    if (points.length < 2) continue;
    const signs = [...new Set(l.map((p) => p.callsign).filter((s): s is string => !!s))];
    const byCallsign = wanted !== null && signs.some((s) => numericCallsign(s) === wanted);
    const fit = fitTrack(points, flight, ref, byCallsign ? CALLSIGN_SLACK_MS : TRACK_TIME_SLACK_MS);
    const first = points[0]!.t * 1000;
    const last = points[points.length - 1]!.t * 1000;
    const awayMs = t0 !== null && t1 !== null ? Math.abs((first + last) / 2 - (t0 + t1) / 2) : 0;
    if ("problem" in fit) {
      // The reason worth telling is the one of the leg nearest the flight's times.
      if (awayMs < nearest) [nearest, problem] = [awayMs, fit.problem];
      continue;
    }
    const outside = t0 !== null && t1 !== null && Math.min(t1, last) <= Math.max(t0, first);
    const candidate: Candidate = { points, coverage: fit.coverage, callsign: signs.find((s) => numericCallsign(s) === wanted) ?? signs[signs.length - 1] ?? null, offsetMin: outside ? Math.round((first - t0) / 60_000) : null, byCallsign, awayMs };
    if (!best || better(candidate, best)) best = candidate;
  }
  if (!best) return { problem: problem ?? "No leg in the aircraft's traces fits this flight." };
  const { byCallsign: _b, awayMs: _a, ...match } = best;
  return match;
}
