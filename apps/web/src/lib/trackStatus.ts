// The aircraft's state at a recorded position of a flight's track, for the hover on the flight's map and globe
// (docs/23, "Maps in the app"): the time, height, climb or descent, speed, track and position, as Flightradar24
// shows them. Only recorded positions are described; pointing at a gap says what is missing there.

import { haversineKm, type Store } from "@touchdown/core";
import { esc } from "../components/overlay.tsx";
import { nf } from "./format.ts";

type LonLat = [number, number];

/** A recorded position with what was recorded there. */
export interface TrackSample {
  at: LonLat;
  /** Unix seconds. */
  t: number;
  altitudeFt: number | null;
  groundSpeedKt: number | null;
  headingDeg: number | null;
}

/** A stretch of the route with no position recorded: between two positions, or between an airport and the track. */
export interface TrackGap {
  from: LonLat;
  to: LonLat;
  /** The positions either side; null at an airport. */
  before: TrackSample | null;
  after: TrackSample | null;
  /** The airport at the open end, for the stretches before the first position and after the last. */
  airport: string | null;
}

// As the maps split a track (mapdata.ts): nothing for over 10 minutes and 100 km is a gap; a track that starts or ends
// over 30 km from its airport leaves that stretch unrecorded.
const GAP_INSIDE_S = 10 * 60;
const GAP_INSIDE_KM = 100;
const GAP_AIRPORT_KM = 30;

const km = (a: LonLat, b: LonLat) => haversineKm({ lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] });

/** Whether nothing was recorded between two consecutive positions. */
export function isGap(a: { at: LonLat; t: number }, b: { at: LonLat; t: number }): boolean {
  return b.t - a.t > GAP_INSIDE_S && km(a.at, b.at) > GAP_INSIDE_KM;
}

/** The recorded positions of a flight's track, in order; none when it has no track or its points are not here yet. */
export function trackSamples(store: Store, flightId: string): TrackSample[] {
  const track = store.all("tracks").find((t) => t.flightId === flightId);
  if (!track) return [];
  return store
    .all("track_points")
    .filter((p) => p.trackId === track.id)
    .sort((a, b) => a.seq - b.seq)
    .map((p) => ({ at: [p.lon, p.lat] as LonLat, t: p.t, altitudeFt: p.altitudeFt, groundSpeedKt: p.groundSpeedKt, headingDeg: p.headingDeg }));
}

/** The stretches of a route its track does not record. */
export function trackGaps(samples: TrackSample[], from: LonLat, to: LonLat, fromCode: string, toCode: string): TrackGap[] {
  if (samples.length < 2) return [];
  const out: TrackGap[] = [];
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  if (km(from, first.at) > GAP_AIRPORT_KM) out.push({ from, to: first.at, before: null, after: first, airport: fromCode });
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    if (isGap(a, b)) out.push({ from: a.at, to: b.at, before: a, after: b, airport: null });
  }
  if (km(last.at, to) > GAP_AIRPORT_KM) out.push({ from: last.at, to, before: last, after: null, airport: toCode });
  return out;
}

/** Feet a minute, from the positions either side within 20 minutes; null when there is none, or no height. */
export function verticalSpeed(samples: TrackSample[], i: number): number | null {
  const p = samples[i]!;
  if (p.altitudeFt === null) return null;
  const rates: number[] = [];
  for (const q of [samples[i - 1], samples[i + 1]]) {
    if (!q || q.altitudeFt === null || q.t === p.t || Math.abs(q.t - p.t) > 1200) continue;
    rates.push((q.altitudeFt - p.altitudeFt) / (q.t - p.t));
  }
  return rates.length ? (rates.reduce((x, y) => x + y, 0) / rates.length) * 60 : null;
}

/** Degrees from north from one position to the next. */
export function bearing(a: LonLat, b: LonLat): number {
  const r = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r);
  const x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (t: number) => {
  const d = new Date(t * 1000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const day = (t: number) => new Date(t * 1000).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
/** "8 min", "2 h 07 min". */
export const span = (seconds: number) => {
  const m = Math.round(Math.abs(seconds) / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${pad(m % 60)} min` : `${m} min`;
};
const position = ([lon, lat]: LonLat) => `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? "E" : "W"}`;
const unit = (u: string) => ` <span class="muted">${u}</span>`;

/**
 * The tooltip for a recorded position. Times are UTC with their date (the position is over no airport). `takeoff`
 * (Unix seconds) gives the time since takeoff; without it, the time since the first position.
 */
export function sampleTip(samples: TrackSample[], i: number, takeoff: number | null): string {
  const p = samples[i]!;
  const since = takeoff !== null && p.t >= takeoff ? `${span(p.t - takeoff)} after takeoff` : `${span(p.t - samples[0]!.t)} after the first position`;
  const v = verticalSpeed(samples, i);
  const vs = v === null ? null : Math.abs(v) < 150 ? "level" : `${v > 0 ? "climbing" : "descending"} ${nf.format(Math.round(Math.abs(v) / 50) * 50)}${unit("ft/min")}`;
  const next = samples[i + 1];
  const track = p.headingDeg ?? (next ? bearing(p.at, next.at) : i ? bearing(samples[i - 1]!.at, p.at) : null);
  const rows: [string, string | null][] = [
    ["Altitude", p.altitudeFt === null ? null : p.altitudeFt <= 0 ? "on the ground" : `${nf.format(p.altitudeFt)}${unit("ft")}`],
    ["Vertical speed", vs],
    ["Ground speed", p.groundSpeedKt === null ? null : `${nf.format(p.groundSpeedKt)}${unit("kt")}`],
    ["Track", track === null ? null : `${String(Math.round(track) % 360).padStart(3, "0")}°`],
    ["Position", position(p.at)],
  ];
  return (
    `<strong>${esc(day(p.t))} · ${clock(p.t)} UTC</strong><br><span class="muted">${since}</span>` +
    `<dl class="tip-facts">${rows
      .filter(([, v]) => v !== null)
      .map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`)
      .join("")}</dl>`
  );
}

/** The tooltip for a stretch with no position recorded. */
export function gapTip(g: TrackGap): string {
  const dist = `${nf.format(Math.round(km(g.from, g.to)))} km`;
  if (!g.before && g.after) {
    return `<strong>Before the first position</strong><br>${dist} from ${esc(g.airport)} to the first position, at ${clock(g.after.t)} UTC<br><span class="muted">Drawn as the great circle.</span>`;
  }
  if (g.before && !g.after) {
    return `<strong>After the last position</strong><br>${dist} from the last position, at ${clock(g.before.t)} UTC, to ${esc(g.airport)}<br><span class="muted">Drawn as the great circle.</span>`;
  }
  const a = g.before!;
  const b = g.after!;
  return `<strong>No position received</strong><br>${span(b.t - a.t)} · ${dist}, ${clock(a.t)} to ${clock(b.t)} UTC<br><span class="muted">Drawn as the great circle between the last position before and the first after.</span>`;
}

/** A top-down airliner pointing north in a 24-unit box, centred on (12, 12): the hover marker, turned to the track. */
export const AIRLINER_TOP = "M12 2c.8 0 1.3 1 1.3 2.2V9l7.7 4.6v2l-7.7-2.3v4.6l2.2 1.7V21L12 20l-3.5 1v-1.4l2.2-1.7v-4.6L3 15.6v-2L10.7 9V4.2C10.7 3 11.2 2 12 2z";

/** The nearest of `points` (screen positions, null where hidden) within `radius` of (x, y); -1 when none is. */
export function nearest(points: ([number, number] | null)[], x: number, y: number, radius: number): number {
  let best = -1;
  let bd = radius;
  points.forEach((q, i) => {
    if (!q) return;
    const d = Math.hypot(q[0] - x, q[1] - y);
    if (d < bd) [bd, best] = [d, i];
  });
  return best;
}
