// What a video shows (lib/video.ts), from the log in this browser: its flights with their recorded tracks, and for a
// period its sightings. The pages give the words (the title, the figures at the end), as they do for an image.

import { haversineKm, simplifyTrack, type RefIndex, type Settings, type Sighting, type Store } from "@touchdown/core";
import type { FlightView } from "@touchdown/core/view";
import type { FigureStat } from "./figure.ts";
import { primaryCode } from "./codes.ts";
import { trackIndex, trackRuns, type TrackPoint } from "./mapdata.ts";
import { trackSamples } from "./trackStatus.ts";
import type { VideoContent, VideoLeg, VideoSighting } from "./video.ts";

type LonLat = [number, number];

/** The log a video is made from: the web app's data, or the log `touchdown render` hands its page. */
export interface VideoLog {
  store: Store;
  ref: RefIndex;
  settings(): Settings;
}

/** A track that starts or ends this far from its airport leaves that stretch unrecorded (as the maps draw it). */
const GAP_AIRPORT_KM = 30;
/** A period draws many flights small: a few hundred points a track look the same. */
const PERIOD_TRACK_POINTS = 400;

const km = (a: LonLat, b: LonLat) => haversineKm({ lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] });

/** A flight's positions from its departure to its arrival, with the stretches nothing was recorded on. */
function route(from: LonLat, to: LonLat, full: TrackPoint[] | undefined, points: number): { points: LonLat[]; gap: boolean[] } {
  if (!full || full.length < 2) return { points: [from, to], gap: [false] };
  // Split at the gaps first: thinning a track leaves points far apart that were not, and those would read as gaps.
  const { runs } = trackRuns(full);
  const thin = runs.map((r) => {
    const share = Math.max(2, Math.round((points * r.length) / full.length));
    return r.length <= share ? r : simplifyTrack(r.map(([lon, lat]) => ({ lon, lat })), share).map((p) => [p.lon, p.lat] as LonLat);
  });
  const out: LonLat[] = [from];
  const gap: boolean[] = [];
  thin.forEach((r, i) => {
    gap.push(i === 0 ? km(from, r[0]!) > GAP_AIRPORT_KM : true);
    out.push(r[0]!);
    for (let k = 1; k < r.length; k++) {
      gap.push(false);
      out.push(r[k]!);
    }
  });
  gap.push(km(out[out.length - 1]!, to) > GAP_AIRPORT_KM);
  out.push(to);
  return { points: out, gap };
}

function legOf(app: VideoLog, v: FlightView, tracks: Map<string, TrackPoint[]>, points: number): VideoLeg | null {
  const { ref } = app;
  const a = ref.airport(v.f.fromAirportId);
  const b = ref.airport(v.f.divertedToAirportId ?? v.f.toAirportId);
  if (!a || !b) return null;
  const from: LonLat = [a.lon, a.lat];
  const to: LonLat = [b.lon, b.lat];
  const takeoff = v.f.takeoffAt ? Date.parse(v.f.takeoffAt) : NaN;
  return {
    id: v.f.id,
    from,
    to,
    fromCode: primaryCode(a),
    toCode: primaryCode(b),
    fromId: a.id,
    toId: b.id,
    ...route(from, to, tracks.get(v.f.id), points),
    when: Number.isFinite(takeoff) ? takeoff : v.day ? Date.parse(`${v.day}T12:00:00Z`) : null,
    day: v.day,
    km: v.km,
    minutes: v.min,
  };
}

const unitOf = (app: VideoLog) => app.settings().distanceUnit ?? "km";

/** A flight's video: its aircraft along its whole recorded track, with what was recorded on the way. */
export function flightVideo(app: VideoLog, v: FlightView, words: { title: string; subtitle?: string; stats?: FigureStat[] }): VideoContent {
  const tracks = trackIndex(app.store);
  const leg = legOf(app, v, tracks, Infinity);
  const takeoff = v.f.takeoffAt ? Date.parse(v.f.takeoffAt) / 1000 : NaN;
  const landing = v.f.landingAt ? Date.parse(v.f.landingAt) / 1000 : NaN;
  return {
    kind: "flight",
    ...words,
    legs: leg ? [leg] : [],
    samples: trackSamples(app.store, v.f.id),
    takeoff: Number.isFinite(takeoff) ? takeoff : null,
    landing: Number.isFinite(landing) ? landing : null,
    unit: unitOf(app),
  };
}

/** A period's video: its flights in the order they were flown, and its sightings when given. */
export function periodVideo(app: VideoLog, views: FlightView[], words: { title: string; stats?: FigureStat[] }, sightings: Sighting[] = []): VideoContent {
  const tracks = trackIndex(app.store);
  const legs = views.map((v) => legOf(app, v, tracks, PERIOD_TRACK_POINTS)).filter((l): l is VideoLeg => l !== null);
  const seen: VideoSighting[] = [];
  for (const s of sightings) {
    const a = app.ref.airport(s.airportId);
    if (!a) continue;
    seen.push({ placeId: a.id, at: [a.lon, a.lat], code: primaryCode(a), day: s.seenOn, airframe: s.airframeId });
  }
  return { kind: "period", ...words, legs, sightings: seen, unit: unitOf(app) };
}
