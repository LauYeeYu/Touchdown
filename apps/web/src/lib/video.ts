// A map as a video (requirement F4, docs/23-tracks-and-maps.md, "Export: video"), made in the browser: a flight, with
// its aircraft moving along the track and what was recorded on the way, or a period's flights (a year, the whole log,
// an aircraft's), drawn in the order they were flown with a date ticker and running totals. Drawn on a canvas as the
// images are (lib/figure.ts: the same land, colours, type and logo), frame by frame at exact times, encoded with
// WebCodecs and written as MP4 (lib/mp4.ts). Nothing is sent anywhere from here.
//
// What keeps it pleasant to watch: every frame is drawn at its own time and every frame lasts as long (no judder);
// the view moves rarely, starts and stops at rest, and during a period only widens; words change no faster than they
// can be read and figures keep their width (Source Sans 3's figures are all one width); lines never crawl, since dots
// and dashes keep their place on the ground; nothing flashes.

import { geoCentroid, geoDistance, geoGraticule10, geoInterpolate, geoOrthographic, geoPath, type GeoProjection } from "d3-geo";
import type { Feature, FeatureCollection } from "geojson";
import { haversineKm } from "@touchdown/core";
import { t } from "@touchdown/i18n";
import type { MapFlight } from "../components/maps.tsx";
import { COLOURS, drawMark, landNow, loadFonts, loadLand, MAX_LABELS, measure, overlaps, projectionFor, sans, spaced, STAT, statTiles, type Box, type Colours, type FigureStat, type FigureTheme } from "./figure.ts";
import { dateOnly, distance, durShort, nf } from "./format.ts";
import { AIRLINER_TOP, isGap, type TrackSample } from "./trackStatus.ts";
import { camAt, camFor, clamp, dateClock, easeInOut, easeOut, planMoves, ramped, smoother, tickerChanges, timeline, union, type Cam, type Rect } from "./videoPlan.ts";
import { mp4, type Mp4Sample } from "./mp4.ts";

type LonLat = [number, number];

export type VideoSize = "landscape" | "square" | "portrait";

/** The sizes offered: the image's screen sizes, which phones, chat apps and social media take as they are. */
export const VIDEO_SIZES: Record<VideoSize, { width: number; height: number }> = {
  landscape: { width: 1920, height: 1080 },
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1920 },
};

export const VIDEO_SECONDS = [10, 15, 20, 30, 45, 60, 90, 120] as const;
export const VIDEO_RATES = [30, 60] as const;

/** A flight in a video. */
export interface VideoLeg {
  id: string;
  from: LonLat;
  to: LonLat;
  fromCode: string;
  toCode: string;
  fromId: string;
  toId: string;
  /** Positions from the departure to the arrival, in order; `gap[i]` when nothing was recorded from point i to i + 1. */
  points: LonLat[];
  gap: boolean[];
  /** When it flew (ms): its takeoff, else noon UTC on its day; null when undated. */
  when: number | null;
  /** Its local day, for the ticker. */
  day: string | null;
  km: number | null;
  minutes: number | null;
}

/** One aircraft seen at a place on a day. */
export interface VideoSighting {
  placeId: string;
  at: LonLat;
  code: string;
  day: string | null;
  airframe: string | null;
}

/** What a video shows, whatever its size, length and theme. */
export interface VideoContent {
  kind: "flight" | "period";
  title: string;
  /** Under the title of a flight (its date and distance). A period has its date ticker there instead. */
  subtitle?: string;
  legs: VideoLeg[];
  sightings?: VideoSighting[];
  /** A flight's recorded positions with their height and speed, for the figures under its map. */
  samples?: TrackSample[];
  /** A flight's takeoff and landing, Unix seconds. */
  takeoff?: number | null;
  landing?: number | null;
  /** The figures shown at the end, as the image's statistics. */
  stats?: FigureStat[];
  unit: "km" | "mi" | "nm";
}

export interface VideoOptions {
  width: number;
  height: number;
  theme: FigureTheme;
  seconds: number;
}

export interface Scene {
  width: number;
  height: number;
  duration: number;
  /** Draw the frame at `time` seconds on a canvas of the scene's size (or scaled to it by the caller's transform). */
  draw(ctx: CanvasRenderingContext2D, time: number): void;
}

// ——— Words and layout shared by both kinds ———

/** The words a video writes, for the typeface's files its characters need. */
function wordsOf(c: VideoContent): string {
  const months = Array.from({ length: 12 }, (_, i) => dateOnly(`2000-${String(i + 1).padStart(2, "0")}-01`, { month: "long", year: "numeric" }));
  const labels = [t("stats.flights.flights"), t("home.facts.time"), t("stats.flights.airports"), t("spotting.facts.aircraft"), t("data.track.altitude"), t("data.track.groundSpeed"), t("flights.detail.distance.label", { basis: "track" }), t("flights.detail.distance.label", { basis: "other" })];
  const stats = (c.stats ?? []).flatMap((s) => [s.label, s.value, s.detail ?? ""]);
  const codes = [...c.legs.flatMap((l) => [l.fromCode, l.toCode]), ...(c.sightings ?? []).map((s) => s.code)];
  return spaced([c.title, c.subtitle ?? "", ...months, ...labels, ...stats, ...codes, "0123456789,.:·hm ftkt", "Touchdown"].join(" "));
}

/** Everything a video needs before it is drawn: the fine land and the typeface for its words. */
export async function prepareVideo(c: VideoContent): Promise<void> {
  await Promise.all([loadLand(), loadFonts(wordsOf(c))]);
}

interface Words {
  size: number;
  weight: number;
  fill: string;
  halo?: { colour: string; width: number };
  align?: "left" | "right";
  maxWidth?: number;
  letterSpacing?: number;
  alpha?: number;
}

function text(ctx: CanvasRenderingContext2D, words: string, x: number, y: number, w: Words) {
  const s = spaced(words);
  ctx.globalAlpha = w.alpha ?? 1;
  ctx.font = `${w.weight} ${w.size}px ${sans()}`;
  ctx.letterSpacing = `${w.letterSpacing ?? 0}px`;
  ctx.textAlign = w.align ?? "left";
  ctx.textBaseline = "alphabetic";
  if (w.halo) {
    ctx.lineJoin = "round";
    ctx.lineWidth = w.halo.width;
    ctx.strokeStyle = w.halo.colour;
    ctx.strokeText(s, x, y, w.maxWidth);
  }
  ctx.fillStyle = w.fill;
  ctx.fillText(s, x, y, w.maxWidth);
  ctx.letterSpacing = "0px";
  ctx.textAlign = "left";
  ctx.globalAlpha = 1;
}

/** A band of paper fading into the map, from `clear` (transparent) to `solid`, and solid on to `end`. */
function fade(ctx: CanvasRenderingContext2D, width: number, clear: number, solid: number, end: number, colour: string) {
  const g = ctx.createLinearGradient(0, clear, 0, solid);
  g.addColorStop(0, `${colour}00`);
  g.addColorStop(1, colour);
  ctx.fillStyle = g;
  ctx.fillRect(0, Math.min(clear, solid), width, Math.abs(solid - clear));
  ctx.fillStyle = colour;
  ctx.fillRect(0, Math.min(solid, end), width, Math.abs(end - solid));
}

/** The frame's fixed parts: the title band, the logo and the figures' band, sized as the image's are. */
interface Frame {
  u: number;
  c: Colours;
  width: number;
  height: number;
  band: number;
  logo: { x: number; y: number; scale: number; markH: number; nameSize: number; right: number; bottom: number; box: Box; width: number };
}

function frameOf(width: number, height: number, theme: FigureTheme): Frame {
  const u = width / (width / height >= 1.4 ? 1200 : 1000);
  const nameSize = 26 * u;
  const markH = (nameSize * 25) / 18;
  const scale = markH / 20.5;
  const markW = 28 * scale;
  const nameW = measure("Touchdown", nameSize, 600, -0.015 * nameSize);
  const logoW = markW + 13 * u + nameW;
  const right = width - 64 * u;
  const bottom = 92 * u + 0.18 * markH;
  return {
    u,
    c: COLOURS[theme],
    width,
    height,
    band: 150 * u,
    logo: { x: right - logoW, y: bottom - markH, scale, markH, nameSize, right, bottom, box: [right - logoW - 8 * u, bottom - markH - 8 * u, right + 8 * u, bottom + 8 * u], width: logoW },
  };
}

function drawTop(ctx: CanvasRenderingContext2D, f: Frame, title: string) {
  const { u, c } = f;
  fade(ctx, f.width, f.band + 16 * u, f.band, 0, c.paper);
  text(ctx, title, 64 * u, 92 * u, { size: 52 * u, weight: 700, fill: c.ink, maxWidth: f.width - 128 * u - f.logo.width - 40 * u });
  drawMark(ctx, f.logo.x, f.logo.y, f.logo.scale, c.ink, c.flown, c.paper);
  text(ctx, "Touchdown", f.logo.right, f.logo.bottom - f.logo.markH / 2 + 0.36 * f.logo.nameSize, { size: f.logo.nameSize, weight: 600, fill: c.ink, align: "right", letterSpacing: -0.015 * f.logo.nameSize, halo: { colour: c.paper, width: 5 * f.u } });
}

/** A band of figures at the bottom, laid out once from its widest values so nothing moves as the figures change. */
interface Tiles {
  layout: ReturnType<typeof statTiles>;
  top: number;
}

function tilesOf(f: Frame, widest: FigureStat[]): Tiles | null {
  if (!widest.length) return null;
  const layout = statTiles(widest, f.u, 64 * f.u, f.width - 64 * f.u);
  return { layout, top: f.height - 44 * f.u - layout.height };
}

function drawTiles(ctx: CanvasRenderingContext2D, f: Frame, tiles: Tiles, values: FigureStat[], alpha: number, rise = 0) {
  if (alpha <= 0) return;
  const { u, c } = f;
  let i = 0;
  tiles.layout.rows.forEach((row, r) => {
    const y = tiles.top + r * (tiles.layout.rowHeight + tiles.layout.rowGap) + rise;
    for (const tile of row) {
      const s = values[i++] ?? tile.s;
      text(ctx, s.label, tile.x, y + 15 * u, { size: STAT.label * u, weight: 600, fill: c.ink3, maxWidth: tile.w, alpha });
      text(ctx, s.value, tile.x, y + 52 * u, { size: STAT.value * u, weight: 700, fill: c.ink, maxWidth: tile.w, alpha });
      if (s.detail) text(ctx, s.detail, tile.x, y + 76 * u, { size: STAT.detail * u, weight: 400, fill: c.ink2, maxWidth: tile.w, alpha });
    }
  });
}

/** The band behind the figures: paper fading up into the map from just above `top`. */
const drawBottom = (ctx: CanvasRenderingContext2D, f: Frame, top: number) => fade(ctx, f.width, top - 36 * f.u, top - 12 * f.u, f.height, f.c.paper);

/** Two bands of figures, one giving way to the other: the first fades and the second rises into place. */
function drawTileSwap(ctx: CanvasRenderingContext2D, f: Frame, a: { tiles: Tiles; values: FigureStat[] } | null, b: { tiles: Tiles; values: FigureStat[] } | null, s: number) {
  const top = a && b ? a.tiles.top + (b.tiles.top - a.tiles.top) * easeInOut(s) : (a ?? b)!.tiles.top;
  drawBottom(ctx, f, top);
  if (a) drawTiles(ctx, f, a.tiles, a.values, 1 - easeOut(s * 1.6));
  if (b) drawTiles(ctx, f, b.tiles, b.values, easeOut((s - 0.35) / 0.65), (1 - easeOut((s - 0.35) / 0.65)) * 10 * f.u);
}

/** A place's code beside its dot, right of it unless that covers something taken, else left, else nothing. */
function placeLabel(f: Frame, code: string, x: number, y: number, dot: number, taken: Box[]): Box | null {
  const size = 24 * f.u;
  const half = 14 * f.u;
  const gap = dot + 6 * f.u;
  const w = measure(code, size, 700);
  const right: Box = [x + gap, y - half, x + gap + w, y + half];
  const left: Box = [x - gap - w, y - half, x - gap, y + half];
  const free = (b: Box) => b[0] >= 0 && b[2] <= f.width && b[1] >= 0 && b[3] <= f.height && !taken.some((tk) => overlaps(b, tk));
  return free(right) ? right : free(left) ? left : null;
}

const drawCode = (ctx: CanvasRenderingContext2D, f: Frame, code: string, box: Box, y: number, alpha: number) =>
  text(ctx, code, box[0], y + 0.35 * 24 * f.u, { size: 24 * f.u, weight: 700, fill: f.c.ink, halo: { colour: f.c.paper, width: 6 * f.u }, alpha });

/** Distance in a figure, in the chosen unit. */
const dist = (km: number, unit: VideoContent["unit"]) => distance(km, unit);

// ——— Geometry ———

const RAD = Math.PI / 180;
const kmBetween = (a: LonLat, b: LonLat) => haversineKm({ lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] });

/** A route's positions with the stretches between them filled in along great circles, at most `stepDeg` apart. */
function densify(points: LonLat[], gap: boolean[], stepDeg = 1): { at: LonLat[]; gap: boolean[]; src: number[]; frac: number[] } {
  const at: LonLat[] = [points[0]!];
  const gaps: boolean[] = [];
  const src: number[] = [0];
  const frac: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const deg = geoDistance(a, b) / RAD;
    const n = Math.max(1, Math.ceil(deg / stepDeg));
    const between = n > 1 ? geoInterpolate(a, b) : null;
    for (let k = 1; k <= n; k++) {
      at.push(k === n ? b : (between!(k / n) as LonLat));
      gaps.push(!!gap[i - 1]);
      src.push(i - 1);
      frac.push(k / n);
    }
  }
  return { at, gap: gaps, src, frac };
}

// ——— A period: flights drawn in the order they were flown ———

interface PlaneLeg {
  leg: VideoLeg;
  xs: Float64Array;
  ys: Float64Array;
  /** Distance along the line on the final drawing, at each point. */
  len: Float64Array;
  /** The stretch from point i to i + 1: drawn (0), not recorded (1), or across the map's edge (2, not drawn). */
  kind: Uint8Array;
  total: number;
  solid: Path2D;
  dots: Path2D;
  box: Rect;
}

/** A flight on the final drawing: its points projected, and its two kinds of line as paths. */
function planeLeg(leg: VideoLeg, proj: GeoProjection, wrap: number): PlaneLeg | null {
  const d = densify(leg.points, leg.gap);
  const n = d.at.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = proj(d.at[i]!);
    xs[i] = p ? p[0] : NaN;
    ys[i] = p ? p[1] : NaN;
  }
  const kind = new Uint8Array(Math.max(0, n - 1));
  const len = new Float64Array(n);
  const solid = new Path2D();
  const dots = new Path2D();
  let box: Rect = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) if (Number.isFinite(xs[i]! + ys[i]!)) box = union(box, [xs[i]!, ys[i]!, xs[i]!, ys[i]!]);
  if (!Number.isFinite(box[0])) return null;
  for (let i = 1; i < n; i++) {
    const dx = xs[i]! - xs[i - 1]!;
    const dy = ys[i]! - ys[i - 1]!;
    // A step across the map's edge (a flat world cut at its meridian) is not drawn.
    const broken = !Number.isFinite(dx + dy) || Math.abs(dx) > wrap;
    kind[i - 1] = broken ? 2 : d.gap[i - 1] ? 1 : 0;
    len[i] = len[i - 1]! + (broken ? 0 : Math.hypot(dx, dy));
  }
  for (let i = 1; i < n; i++) {
    const k = kind[i - 1];
    if (k === 2) continue;
    const path = k === 1 ? dots : solid;
    if (i === 1 || kind[i - 2] !== k) path.moveTo(xs[i - 1]!, ys[i - 1]!);
    path.lineTo(xs[i]!, ys[i]!);
  }
  return { leg, xs, ys, len, kind, total: len[n - 1]!, solid, dots, box };
}

/** Draw a flight's line from its start as far as `upTo` along it: its drawn stretches, or its unrecorded ones. */
function partial(ctx: CanvasRenderingContext2D, p: PlaneLeg, upTo: number, which: 0 | 1): [number, number] | null {
  let head: [number, number] | null = null;
  ctx.beginPath();
  let open = false;
  for (let i = 1; i < p.xs.length; i++) {
    if (p.len[i - 1]! >= upTo && p.total > 0) break;
    const k = p.kind[i - 1];
    const x0 = p.xs[i - 1]!;
    const y0 = p.ys[i - 1]!;
    let x1 = p.xs[i]!;
    let y1 = p.ys[i]!;
    if (p.len[i]! > upTo && p.len[i]! > p.len[i - 1]!) {
      const s = (upTo - p.len[i - 1]!) / (p.len[i]! - p.len[i - 1]!);
      x1 = x0 + (x1 - x0) * s;
      y1 = y0 + (y1 - y0) * s;
    }
    if (k !== 2) head = [x1, y1];
    if (k !== which) {
      open = false;
      continue;
    }
    if (!open) ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    open = true;
  }
  return head;
}

interface Place {
  id: string;
  code: string;
  at: LonLat;
  x: number;
  y: number;
  /** Seconds into the video when its dot appears. */
  shows: number;
  label: Box | null;
}

interface SpotPlace {
  id: string;
  x: number;
  y: number;
  /** When it grew, and how many aircraft it showed from then. */
  steps: { t: number; count: number }[];
}

/** The steps of a period video: a moment on the first place before anything is drawn, and time at the end to read
 * the figures. */
const INTRO = 1.6;
const outroOf = (seconds: number) => clamp(seconds * 0.15, 3.8, 7);
/** How far ahead the view moves for what comes next, and how long a drawn line takes to settle. */
const LEAD = 0.7;
const SETTLE = 0.9;

function periodScene(content: VideoContent, o: VideoOptions): Scene {
  const f = frameOf(o.width, o.height, o.theme);
  const { u, c } = f;
  const duration = o.seconds;
  const unit = content.unit;
  const legs = [...content.legs].sort((a, b) => (a.when ?? Infinity) - (b.when ?? Infinity));
  const sightings = content.sightings ?? [];

  // Events in date order: each flight, and each day at a spotting place.
  type Event = { when: number | null; leg?: VideoLeg; spot?: { placeId: string; at: LonLat; code: string; airframes: string[] } };
  const spotDays = new Map<string, { when: number | null; placeId: string; at: LonLat; code: string; airframes: string[] }>();
  for (const s of sightings) {
    const key = `${s.placeId}|${s.day ?? ""}`;
    const e = spotDays.get(key) ?? { when: s.day ? Date.parse(`${s.day}T12:00:00Z`) : null, placeId: s.placeId, at: s.at, code: s.code, airframes: [] };
    e.airframes.push(s.airframe ?? `${key}|${e.airframes.length}`);
    spotDays.set(key, e);
  }
  const events: Event[] = [...legs.map((leg) => ({ when: leg.when, leg })), ...[...spotDays.values()].map((s) => ({ when: s.when, spot: s }))].sort((a, b) => (a.when ?? Infinity) - (b.when ?? Infinity));

  // The figures counted up as the flights land, laid out at their final values (the widest).
  const totalKm = legs.reduce((s, l) => s + (l.km ?? 0), 0);
  const totalMin = legs.reduce((s, l) => s + (l.minutes ?? 0), 0);
  const placesAll = new Map<string, { code: string; at: LonLat }>();
  for (const l of legs) {
    placesAll.set(l.fromId, { code: l.fromCode, at: l.from });
    placesAll.set(l.toId, { code: l.toCode, at: l.to });
  }
  const spottedAll = new Set(sightings.map((s, i) => s.airframe ?? `#${i}`));
  const counters = (flights: number, km: number, min: number, airports: number, spotted: number): FigureStat[] =>
    [
      legs.length ? { label: t("stats.flights.flights"), value: nf.format(flights) } : null,
      legs.length && totalKm > 0 ? { label: t("flights.detail.distance.label", { basis: "other" }), value: dist(km, unit) } : null,
      totalMin > 0 ? { label: t("home.facts.time"), value: durShort(min) } : null,
      legs.length ? { label: t("stats.flights.airports"), value: nf.format(airports) } : null,
      sightings.length ? { label: t("spotting.facts.aircraft"), value: nf.format(spotted) } : null,
    ].filter((x): x is FigureStat => x !== null);
  const totals = tilesOf(f, counters(legs.length, totalKm, totalMin, placesAll.size, spottedAll.size));
  const summary = content.stats?.length ? tilesOf(f, content.stats) : null;
  const bandTop = Math.min(totals?.top ?? f.height, summary?.top ?? f.height);

  // The final drawing: the image's projection, fitted between the title and the figures.
  const labelled = placesAll.size + new Set(sightings.map((s) => s.placeId).filter((id) => !placesAll.has(id))).size <= MAX_LABELS;
  const side = 64 * u + (labelled ? 72 * u : 0);
  const area: Rect = [side, f.band + 20 * u, f.width - side, bandTop - 40 * u];
  const asFlights = legs.map((l) => ({ from: l.from, to: l.to, line: [l.points], gaps: [] }) as unknown as MapFlight);
  const spotMarks = [...spotDays.values()].map((s) => ({ at: s.at, code: s.code }));
  const { proj, globe } = projectionFor({ flights: asFlights, spots: spotMarks, width: f.width, height: f.height, theme: o.theme }, [[area[0], area[1]], [area[2], area[3]]]);
  proj.clipExtent(null);
  const landPath = new Path2D();
  const grid = new Path2D();
  const sphere = new Path2D();
  geoPath(proj, landPath as never)(landNow());
  geoPath(proj, grid as never)(geoGraticule10());
  geoPath(proj, sphere as never)({ type: "Sphere" });
  // A step longer than half the world's width crosses the edge of a flat map.
  const [[sx0], [sx1]] = geoPath(proj).bounds({ type: "Sphere" });
  const wrap = Math.max(f.width * 0.25, (sx1 - sx0) / 2);

  // The timeline: when each event is drawn.
  const tl = timeline(
    events.map((e) => e.when),
    events.map((e) => (e.leg ? Math.sqrt(clamp((e.leg.km ?? 0) / 9000, 0, 1)) : 0)),
    [INTRO, Math.max(INTRO + 1, duration - outroOf(duration))],
  );
  const slots = tl.slots.map((s, i) => (events[i]!.spot ? { start: s.start, duration: 0.45 } : s));
  const roomy = slots.length < 2 || (tl.to - tl.from) / slots.length > 0.55;

  // Each flight on the final drawing.
  const plane: (PlaneLeg | null)[] = events.map((e) => (e.leg ? planeLeg(e.leg, proj, wrap) : null));
  const count = legs.length;
  const line = count <= 12 ? { width: 4, alpha: 1 } : count <= 60 ? { width: 2.5, alpha: 0.8 } : { width: 1.6, alpha: 0.6 };
  const drawWidth = Math.max(2.8, line.width * 1.5);

  // Places: an airport's dot appears when its first flight leaves or lands there; a spotting place's when first seen.
  const places = new Map<string, Place>();
  const placeAt = (id: string, code: string, at: LonLat, time: number) => {
    const p = places.get(id);
    if (p) p.shows = Math.min(p.shows, time);
    else {
      const xy = proj(at);
      if (xy) places.set(id, { id, code, at, x: xy[0], y: xy[1], shows: time, label: null });
    }
  };
  events.forEach((e, i) => {
    const s = slots[i]!;
    if (e.leg) {
      placeAt(e.leg.fromId, e.leg.fromCode, e.leg.from, s.start);
      placeAt(e.leg.toId, e.leg.toCode, e.leg.to, s.start + s.duration);
    }
  });
  const spots = new Map<string, SpotPlace>();
  const seenAt = new Map<string, Set<string>>();
  events.forEach((e, i) => {
    if (!e.spot) return;
    const set = seenAt.get(e.spot.placeId) ?? new Set<string>();
    for (const a of e.spot.airframes) set.add(a);
    seenAt.set(e.spot.placeId, set);
    const xy = proj(e.spot.at);
    if (!xy) return;
    const sp = spots.get(e.spot.placeId) ?? { id: e.spot.placeId, x: xy[0], y: xy[1], steps: [] };
    sp.steps.push({ t: slots[i]!.start, count: set.size });
    spots.set(e.spot.placeId, sp);
    if (labelled && !places.has(e.spot.placeId)) places.set(e.spot.placeId, { id: e.spot.placeId, code: e.spot.code, at: e.spot.at, x: xy[0], y: xy[1], shows: slots[i]!.start, label: null });
  });
  const mostSeen = Math.max(1, ...[...spots.values()].map((s) => s.steps[s.steps.length - 1]!.count));
  const airportIds = new Set(placesAll.keys());
  const dotR = (labelled ? 7 : placesAll.size > 60 ? 3 : 4) * u;
  // A spotting place's dot, sized by the aircraft seen as the image sizes it, and at an airport at least a ring wider
  // than the airport's dot drawn over it, so a place with few aircraft does not vanish under it.
  const spotR = (n: number, id?: string) => Math.max((4 + 9 * Math.sqrt(n / mostSeen)) * u, id && airportIds.has(id) ? dotR + 3 * u : 0);

  // The view: around the first events, widening as the flights reach further, until it is the final drawing.
  const finalCam: Cam = { cx: (area[0] + area[2]) / 2, cy: (area[1] + area[3]) / 2, k: 1 };
  const wanted: { t: number; cam: Cam }[] = [];
  let seen: Rect | null = null;
  events.forEach((e, i) => {
    const p = plane[i];
    const at = e.spot ? proj(e.spot.at) : null;
    const box: Rect | null = p ? p.box : at ? [at[0], at[1], at[0], at[1]] : null;
    if (!box) return;
    seen = seen ? union(seen, box) : box;
    wanted.push({ t: i === 0 ? 0 : slots[i]!.start - LEAD, cam: camFor(seen, area, [0, 0, f.width, f.height]) });
  });
  if (wanted.length) wanted.push({ t: Math.max(wanted[wanted.length - 1]!.t, tl.to - LEAD), cam: finalCam });
  const cams = wanted.length ? planMoves(wanted, area) : { start: finalCam, moves: [] };
  const camera = (time: number) => camAt(cams, time);
  const toScreen = (cam: Cam, x: number, y: number): [number, number] => [(x - cam.cx) * cam.k + (area[0] + area[2]) / 2, (y - cam.cy) * cam.k + (area[1] + area[3]) / 2];

  // Codes: every place's, placed on the final drawing as the image places them, while there are few; else the codes
  // of a flight drawn on its own for long enough to read them, for as long as it is drawn and a moment after.
  const hud: Box[] = [f.logo.box, [0, 0, f.width, f.band], [0, bandTop - 16 * u, f.width, f.height]];
  const dotBoxes: Box[] = [...places.values()].filter((p) => airportIds.has(p.id)).map((p) => [p.x - dotR, p.y - dotR, p.x + dotR, p.y + dotR]);
  if (labelled) {
    const taken = [...dotBoxes, ...hud];
    for (const p of [...places.values()].sort((a, b) => a.shows - b.shows)) {
      if (!p.code || p.code === "?") continue;
      const sp = spots.get(p.id);
      const r = Math.max(airportIds.has(p.id) ? dotR : 0, sp ? spotR(sp.steps[sp.steps.length - 1]!.count, p.id) : 0);
      p.label = placeLabel(f, p.code, p.x, p.y, r, taken);
      if (p.label) taken.push(p.label);
    }
  }
  const passing: { code: string; x: number; y: number; from: number; to: number; dx: number; side: "right" | "left" }[] = [];
  if (!labelled) {
    events.forEach((e, i) => {
      if (!e.leg) return;
      const s = slots[i]!;
      const next = slots[i + 1]?.start ?? Infinity;
      if (next - s.start < 0.9) return;
      const until = Math.min(s.start + s.duration + 1.1, next + 0.2);
      for (const [code, at, from] of [[e.leg.fromCode, e.leg.from, s.start], [e.leg.toCode, e.leg.to, s.start + s.duration * 0.6]] as const) {
        const xy = proj(at);
        if (!xy || !code || code === "?") continue;
        const cam = camera(from);
        const [sx, sy] = toScreen(cam, xy[0], xy[1]);
        const live = passing.filter((q) => q.to > from && q.from < until).map((q) => {
          const [qx, qy] = toScreen(cam, q.x, q.y);
          const w = measure(q.code, 24 * u, 700);
          return (q.side === "right" ? [qx + q.dx, qy - 14 * u, qx + q.dx + w, qy + 14 * u] : [qx - q.dx - w, qy - 14 * u, qx - q.dx, qy + 14 * u]) as Box;
        });
        const box = placeLabel(f, code, sx, sy, dotR, [...hud, ...live]);
        if (!box) continue;
        passing.push({ code, x: xy[0], y: xy[1], from, to: until, dx: dotR + 6 * u, side: box[0] > sx ? "right" : "left" });
      }
    });
  }

  // The ticker: the month (the day, for a period of a few weeks), never changing faster than it can be read.
  const dated = events.filter((e) => e.when !== null).map((e) => e.when!);
  const spanDays = dated.length ? (dated[dated.length - 1]! - dated[0]!) / 86_400_000 : 0;
  const clock = dateClock(slots, events.map((e) => e.when));
  const tickerText = (time: number) => {
    const d = clock(time);
    if (d === null) return "";
    const ymd = new Date(d).toISOString().slice(0, 10);
    return spanDays <= 45 ? dateOnly(ymd, { day: "numeric", month: "long", year: "numeric" }) : dateOnly(ymd, { month: "long", year: "numeric" });
  };
  const ticker = dated.length ? tickerChanges(tickerText, 0, tl.to) : [];

  // Lines finished by a time, in the order they finish, gathered into one path so a route flown often is not darker.
  const finishing = events.map((e, i) => ({ i, end: slots[i]!.start + slots[i]!.duration })).filter((x) => plane[x.i]).sort((a, b) => a.end - b.end);
  let doneSolid = new Path2D();
  let doneDots = new Path2D();
  let doneCount = 0;
  const finished = (time: number) => {
    let n = 0;
    while (n < finishing.length && finishing[n]!.end <= time) n++;
    if (n < doneCount) {
      doneSolid = new Path2D();
      doneDots = new Path2D();
      doneCount = 0;
    }
    for (; doneCount < n; doneCount++) {
      const p = plane[finishing[doneCount]!.i]!;
      doneSolid.addPath(p.solid);
      doneDots.addPath(p.dots);
    }
  };

  const draw = (ctx: CanvasRenderingContext2D, time: number) => {
    const cam = camera(time);
    const base = ctx.getTransform();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.fillStyle = c.paper;
    ctx.fillRect(0, 0, f.width, f.height);

    // The map, at the view's zoom: lines keep their width on the screen.
    const ax = (area[0] + area[2]) / 2;
    const ay = (area[1] + area[3]) / 2;
    ctx.transform(cam.k, 0, 0, cam.k, ax - cam.cx * cam.k, ay - cam.cy * cam.k);
    const px = 1 / cam.k;
    if (globe) {
      ctx.fillStyle = c.sphere;
      ctx.fill(sphere);
    }
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1 * u * px;
    ctx.stroke(grid);
    ctx.fillStyle = c.land;
    ctx.fill(landPath);
    ctx.strokeStyle = c.landEdge;
    ctx.lineWidth = 0.8 * u * px;
    ctx.stroke(landPath);

    // Spotting places, the larger under the smaller, growing as aircraft are seen there.
    const spotNow = [...spots.values()]
      .map((sp) => {
        let r = 0;
        let alpha = 0;
        let prev = 0;
        for (const st of sp.steps) {
          if (time < st.t) break;
          const s = easeOut((time - st.t) / 0.45);
          r = spotR(prev, sp.id) + (spotR(st.count, sp.id) - spotR(prev, sp.id)) * s;
          if (!prev) alpha = s;
          prev = st.count;
        }
        if (prev && !alpha) alpha = 1;
        return { sp, r, alpha };
      })
      .filter((x) => x.alpha > 0)
      .sort((a, b) => b.r - a.r);
    for (const { sp, r, alpha } of spotNow) {
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r * px, 0, Math.PI * 2);
      ctx.fillStyle = c.spotted;
      ctx.fill();
      ctx.strokeStyle = c.paper;
      ctx.lineWidth = 2 * u * px;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Finished lines, as the image draws them.
    finished(time);
    ctx.setLineDash([0, 6 * u * px]);
    ctx.strokeStyle = c.gap;
    ctx.lineWidth = Math.min(2.5, line.width) * u * px;
    ctx.stroke(doneDots);
    ctx.setLineDash([]);
    ctx.globalAlpha = line.alpha;
    ctx.strokeStyle = c.flown;
    ctx.lineWidth = line.width * u * px;
    ctx.stroke(doneSolid);
    ctx.globalAlpha = 1;

    // Lines being drawn, brighter and wider, settling into the rest once drawn; a ring where each lands.
    const heads: { x: number; y: number; fadeOut: number }[] = [];
    events.forEach((e, i) => {
      const p = plane[i];
      if (!p) return;
      const s = slots[i]!;
      const age = time - s.start;
      if (age < 0) return;
      const end = s.duration;
      if (age < end) {
        const q = easeInOut(age / end) * p.total;
        ctx.setLineDash([0, 6 * u * px]);
        ctx.strokeStyle = c.gap;
        ctx.lineWidth = Math.min(2.5, drawWidth) * u * px;
        partial(ctx, p, q, 1);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = c.flown;
        ctx.lineWidth = drawWidth * u * px;
        const head = partial(ctx, p, q, 0);
        ctx.stroke();
        if (head) heads.push({ x: head[0], y: head[1], fadeOut: 1 - smoother((age / end - 0.8) / 0.2) });
      } else if (age < end + SETTLE) {
        const k = easeOut((age - end) / SETTLE);
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = c.flown;
        ctx.lineWidth = (drawWidth + (line.width - drawWidth) * k) * u * px;
        ctx.stroke(p.solid);
        ctx.globalAlpha = 1;
      }
      if (roomy && age >= end && age < end + 0.9) {
        const k = easeOut((age - end) / 0.9);
        const xy = proj(p.leg.to);
        if (xy) {
          ctx.globalAlpha = 0.5 * (1 - k);
          ctx.beginPath();
          ctx.arc(xy[0], xy[1], (dotR + (4 + 18 * k) * u) * px, 0, Math.PI * 2);
          ctx.strokeStyle = c.flown;
          ctx.lineWidth = 2 * u * px;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    });
    // The head of each line being drawn: a dot with a soft light around it.
    for (const h of heads) {
      const r = Math.max(3.4, drawWidth * 0.9) * u * px;
      const glow = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, r * 4.5);
      glow.addColorStop(0, `${c.flown}66`);
      glow.addColorStop(1, `${c.flown}00`);
      ctx.globalAlpha = h.fadeOut;
      ctx.fillStyle = glow;
      ctx.fillRect(h.x - r * 4.5, h.y - r * 4.5, r * 9, r * 9);
      ctx.beginPath();
      ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
      ctx.fillStyle = c.flown;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Airports: a paper dot with an ink ring, appearing when first reached.
    for (const p of places.values()) {
      if (!airportIds.has(p.id) || time < p.shows) continue;
      const s = easeOut((time - p.shows) / 0.35);
      ctx.globalAlpha = s;
      ctx.beginPath();
      ctx.arc(p.x, p.y, dotR * (0.5 + 0.5 * s) * px, 0, Math.PI * 2);
      ctx.fillStyle = c.paper;
      ctx.fill();
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = (labelled ? 2.5 : 1.5) * u * px;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.setTransform(base);

    // Codes, on the screen's own scale.
    if (labelled) {
      for (const p of places.values()) {
        if (!p.label || time < p.shows) continue;
        const [sx, sy] = toScreen(cam, p.x, p.y);
        const [fx] = toScreen(finalCam, p.x, p.y);
        const right = p.label[0] > fx;
        const dx = right ? p.label[0] - fx : fx - p.label[2];
        const w = p.label[2] - p.label[0];
        drawCode(ctx, f, p.code, right ? [sx + dx, 0, sx + dx + w, 0] : [sx - dx - w, 0, sx - dx, 0], sy, easeOut((time - p.shows) / 0.4));
      }
    } else {
      for (const q of passing) {
        if (time < q.from || time > q.to) continue;
        const alpha = Math.min(easeOut((time - q.from) / 0.3), 1 - smoother((time - (q.to - 0.4)) / 0.4));
        const [sx, sy] = toScreen(cam, q.x, q.y);
        const w = measure(q.code, 24 * u, 700);
        drawCode(ctx, f, q.code, q.side === "right" ? [sx + q.dx, 0, sx + q.dx + w, 0] : [sx - q.dx - w, 0, sx - q.dx, 0], sy, alpha);
      }
    }

    // The title, the ticker under it, and the logo.
    drawTop(ctx, f, content.title);
    if (ticker.length) {
      let k = 0;
      while (k + 1 < ticker.length && ticker[k + 1]!.t <= time) k++;
      const now = ticker[k]!;
      const s = k > 0 ? smoother((time - now.t) / 0.32) : 1;
      const y = 136 * u;
      const words = { size: 30 * u, weight: 600, fill: c.ink2, maxWidth: f.width - 128 * u };
      if (s < 1) text(ctx, ticker[k - 1]!.text, 64 * u, y - 8 * u * s, { ...words, alpha: 1 - s });
      text(ctx, now.text, 64 * u, y + 8 * u * (1 - s), { ...words, alpha: s });
    }

    // The figures: counted as the flights are drawn, then the period's statistics.
    let flights = 0;
    let km = 0;
    let min = 0;
    events.forEach((e, i) => {
      if (!e.leg) return;
      const s = slots[i]!;
      const q = easeInOut((time - s.start) / s.duration);
      if (time >= s.start + s.duration) flights++;
      km += q * (e.leg.km ?? 0);
      min += q * (e.leg.minutes ?? 0);
    });
    let airports = 0;
    for (const p of places.values()) if (airportIds.has(p.id) && time >= p.shows) airports++;
    const spottedNow = new Set<string>();
    events.forEach((e, i) => {
      if (e.spot && time >= slots[i]!.start) for (const a of e.spot.airframes) spottedNow.add(a);
    });
    const live = counters(flights, km, min, airports, spottedNow.size);
    const swapAt = tl.to + 0.4;
    const s = summary ? clamp((time - swapAt) / 0.9, 0, 1) : 0;
    if (totals || summary) drawTileSwap(ctx, f, totals ? { tiles: totals, values: live } : null, summary ? { tiles: summary, values: content.stats! } : null, totals ? s : 1);
  };

  return { width: f.width, height: f.height, duration, draw };
}

// ——— One flight: the aircraft along its track ———

interface FlightPath {
  at: LonLat[];
  gap: boolean[];
  /** Kilometres from the departure, at each point. */
  km: Float64Array;
  /** Unix seconds at each point, where known. */
  time: (number | null)[];
  alt: (number | null)[];
  speed: (number | null)[];
  total: number;
}

const GAP_AIRPORT_KM = 30;

/** The flight's route as the aircraft follows it: its recorded positions joined to its airports, else the great circle. */
function flightPath(content: VideoContent): FlightPath {
  const leg = content.legs[0]!;
  const samples = content.samples ?? [];
  let pts: { at: LonLat; t: number | null; alt: number | null; speed: number | null }[];
  let gap: boolean[];
  if (samples.length >= 2) {
    const first = samples[0]!;
    const last = samples[samples.length - 1]!;
    pts = [
      { at: leg.from, t: content.takeoff ?? first.t, alt: null, speed: null },
      ...samples.map((s) => ({ at: s.at, t: s.t, alt: s.altitudeFt, speed: s.groundSpeedKt })),
      { at: leg.to, t: content.landing ?? last.t, alt: null, speed: null },
    ];
    gap = [kmBetween(leg.from, first.at) > GAP_AIRPORT_KM, ...samples.slice(1).map((s, i) => isGap(samples[i]!, s)), kmBetween(last.at, leg.to) > GAP_AIRPORT_KM];
  } else {
    pts = [
      { at: leg.from, t: content.takeoff ?? null, alt: null, speed: null },
      { at: leg.to, t: content.landing ?? null, alt: null, speed: null },
    ];
    gap = [false];
  }
  const d = densify(
    pts.map((p) => p.at),
    gap,
    0.5,
  );
  const km = new Float64Array(d.at.length);
  for (let i = 1; i < d.at.length; i++) km[i] = km[i - 1]! + kmBetween(d.at[i - 1]!, d.at[i]!);
  const lerp = (a: number | null, b: number | null, s: number) => (a === null ? b : b === null ? a : a + (b - a) * s);
  const at = (i: number, key: "t" | "alt" | "speed") => {
    const a = pts[d.src[i]!]!;
    const b = pts[Math.min(pts.length - 1, d.src[i]! + (i === 0 ? 0 : 1))]!;
    return i === 0 ? a[key] : lerp(a[key], b[key], d.frac[i]!);
  };
  return {
    at: d.at,
    gap: d.gap,
    km,
    time: d.at.map((_, i) => at(i, "t")),
    alt: d.at.map((_, i) => at(i, "alt")),
    speed: d.at.map((_, i) => at(i, "speed")),
    total: km[km.length - 1]!,
  };
}

/** The point at `s` km along the path, and the index of the stretch it is on. */
function along(p: FlightPath, s: number): { at: LonLat; i: number; f: number } {
  const x = clamp(s, 0, p.total);
  let lo = 0;
  let hi = p.km.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p.km[mid]! <= x) lo = mid;
    else hi = mid;
  }
  const span = p.km[hi]! - p.km[lo]!;
  const f = span > 0 ? (x - p.km[lo]!) / span : 0;
  return { at: geoInterpolate(p.at[lo]!, p.at[hi]!)(f) as LonLat, i: lo, f };
}

const valueAt = (list: (number | null)[], i: number, f: number) => {
  const a = list[i] ?? null;
  const b = list[Math.min(list.length - 1, i + 1)] ?? null;
  return a === null ? b : b === null ? a : a + (b - a) * f;
};

/** Land features with the cap of the sphere each lies in, so a frame draws only those it can show. */
interface Cap {
  feature: Feature;
  centre: LonLat;
  radius: number;
}

function capsOf(land: FeatureCollection): Cap[] {
  return land.features.map((feature) => {
    const centre = geoCentroid(feature) as LonLat;
    let radius = 0;
    const visit = (c: unknown) => {
      if (typeof (c as number[])[0] === "number") radius = Math.max(radius, geoDistance(centre, c as LonLat));
      else for (const x of c as unknown[]) visit(x);
    };
    const g = feature.geometry;
    if (g && "coordinates" in g) visit(g.coordinates);
    return { feature, centre, radius };
  });
}

let capsFor: { land: FeatureCollection; caps: Cap[] } | null = null;
const landCaps = () => {
  const land = landNow();
  if (capsFor?.land !== land) capsFor = { land, caps: capsOf(land) };
  return capsFor.caps;
};

const GRATICULE = geoGraticule10();

/** The steps of a flight video: a moment at the gate, and time after landing to read the flight's figures. */
const HOLD = 1.2;
const landedOf = (seconds: number) => clamp(seconds * 0.2, 3, 6);

function flightScene(content: VideoContent, o: VideoOptions): Scene {
  const f = frameOf(o.width, o.height, o.theme);
  const { u, c } = f;
  const duration = o.seconds;
  const leg = content.legs[0]!;
  const path = flightPath(content);
  const recorded = (content.samples?.length ?? 0) >= 2;
  const unit = content.unit;
  const caps = landCaps();

  // The figures under the map: while it flies, its time in the air, height, speed and distance as recorded; then the
  // flight's statistics. A flight without a recorded track has only its statistics.
  const takeoff = content.takeoff ?? path.time.find((x) => x !== null) ?? null;
  const hasAlt = path.alt.some((x) => x !== null);
  const hasSpeed = path.speed.some((x) => x !== null);
  const flownKm = leg.km ?? path.total;
  const feet = (ft: number) => t("data.track.feet", { ft });
  const knots = (kt: number) => t("data.track.knots", { kt });
  const figures = (minutes: number | null, alt: number | null, speed: number | null, km: number): FigureStat[] =>
    [
      minutes !== null ? { label: t("home.facts.time"), value: durShort(Math.max(0, minutes)) } : null,
      hasAlt ? { label: t("data.track.altitude"), value: feet(Math.max(0, Math.round((alt ?? 0) / 100) * 100)) } : null,
      hasSpeed ? { label: t("data.track.groundSpeed"), value: knots(Math.max(0, Math.round(speed ?? 0))) } : null,
      { label: t("flights.detail.distance.label", { basis: "track" }), value: dist(km, unit) },
    ].filter((x): x is FigureStat => x !== null);
  const readout = (s: number): FigureStat[] => {
    const a = along(path, s);
    const now = valueAt(path.time, a.i, a.f);
    return figures(takeoff !== null ? ((now ?? takeoff) - takeoff) / 60 : null, valueAt(path.alt, a.i, a.f), valueAt(path.speed, a.i, a.f), (s / Math.max(1e-9, path.total)) * flownKm);
  };
  const lastTime = path.time[path.time.length - 1] ?? null;
  const widest = figures(takeoff !== null ? ((lastTime ?? takeoff) - takeoff) / 60 : null, Math.max(0, ...path.alt.map((x) => x ?? 0)), Math.max(0, ...path.speed.map((x) => x ?? 0)), flownKm);
  const live = recorded ? tilesOf(f, widest) : null;
  const summary = content.stats?.length ? tilesOf(f, content.stats) : null;
  const bandTop = Math.min(live?.top ?? f.height, summary?.top ?? f.height);
  const area: Rect = [64 * u + 72 * u, f.band + 20 * u, f.width - 64 * u - 72 * u, bandTop - 40 * u];
  const aw = area[2] - area[0];
  const ah = area[3] - area[1];

  // The view: an orthographic globe. At first close to the departure, then turning and widening to the whole route,
  // which it then keeps. Never closer than about 180 km either side, so a short hop has its region around it.
  const routeDeg = geoDistance(leg.from, leg.to) / RAD;
  const centreEnd = (() => {
    let x = 0;
    let y = 0;
    let z = 0;
    for (const [lon, lat] of path.at) {
      x += Math.cos(lat * RAD) * Math.cos(lon * RAD);
      y += Math.cos(lat * RAD) * Math.sin(lon * RAD);
      z += Math.sin(lat * RAD);
    }
    return [Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD] as LonLat;
  })();
  const minHalf = 1.6 * RAD;
  const fit = (centre: LonLat) => {
    const unitProj = geoOrthographic().rotate([-centre[0], -centre[1]]).scale(1).translate([0, 0]).clipAngle(90);
    let box: Rect = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of path.at) {
      if (geoDistance(p, centre) > Math.PI / 2) continue;
      const xy = unitProj(p)!;
      box = union(box, [xy[0], xy[1], xy[0], xy[1]]);
    }
    const pad = 0.1;
    const r = Math.min((aw * (1 - 2 * pad)) / Math.max(1e-9, box[2] - box[0]), (ah * (1 - 2 * pad)) / Math.max(1e-9, box[3] - box[1]), aw / 2 / Math.sin(minHalf));
    return { r, off: [-(box[0] + box[2]) / 2, -(box[1] + box[3]) / 2] as [number, number] };
  };
  const end = fit(centreEnd);
  const startHalf = clamp(0.4 * routeDeg, 1.6, 12) * RAD;
  const startR = Math.max(end.r, aw / 2 / Math.sin(startHalf));
  const flying = Math.max(1, duration - HOLD - landedOf(duration));
  const moveFrom = HOLD - 0.15;
  const moveTo = HOLD + 0.45 * flying;
  const between = geoInterpolate(leg.from, centreEnd);
  const view = (time: number) => {
    const e = smoother((time - moveFrom) / (moveTo - moveFrom));
    const centre = between(e) as LonLat;
    const r = startR * (end.r / startR) ** e;
    return { centre, r, off: [end.off[0] * e, end.off[1] * e] as [number, number] };
  };
  const projection = (time: number) => {
    const v = view(time);
    return {
      v,
      proj: geoOrthographic()
        .rotate([-v.centre[0], -v.centre[1]])
        .scale(v.r)
        .translate([(area[0] + area[2]) / 2 + v.off[0] * v.r, (area[1] + area[3]) / 2 + v.off[1] * v.r])
        .clipAngle(90)
        .clipExtent([[-8, -8], [f.width + 8, f.height + 8]]),
    };
  };

  // Where the aircraft is: still at the gate, then along the route at a steady speed with a gentle start and stop.
  const progress = (time: number) => ramped((time - HOLD) / flying) * path.total;
  const landedAt = HOLD + flying;
  const refDots = (() => {
    const n = clamp(Math.round(path.total / 25), 40, 220);
    const gc = geoInterpolate(leg.from, leg.to);
    return Array.from({ length: n + 1 }, (_, i) => gc(i / n) as LonLat);
  })();
  const gapStep = Math.max(4, path.total / 160);

  // Codes beside the two airports, placed for the whole route's view.
  const endProj = projection(duration).proj;
  const hud: Box[] = [f.logo.box, [0, 0, f.width, f.band], [0, bandTop - 16 * u, f.width, f.height]];
  const ends = ([[leg.fromCode, leg.from], [leg.toCode, leg.to]] as const).map(([code, at]) => {
    const xy = endProj(at) ?? [0, 0];
    return { code, at, right: true, dx: 7 * u + 6 * u, xy };
  });
  {
    const taken: Box[] = [...hud, ...ends.map((e): Box => [e.xy[0] - 7 * u, e.xy[1] - 7 * u, e.xy[0] + 7 * u, e.xy[1] + 7 * u])];
    for (const e of ends) {
      const box = placeLabel(f, e.code, e.xy[0], e.xy[1], 7 * u, taken);
      if (box) {
        e.right = box[0] > e.xy[0];
        taken.push(box);
      }
    }
  }
  const plane = new Path2D(AIRLINER_TOP);
  const bases = new Map<string, HTMLCanvasElement>();

  const draw = (ctx: CanvasRenderingContext2D, time: number) => {
    const { v, proj } = projection(time);
    const visible = (p: LonLat) => geoDistance(p, v.centre) < Math.PI / 2 - 0.01;
    const path2d = geoPath(proj, ctx);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // The map under the route: the same for every frame while the view is still (at the gate, and once it shows the
    // whole route), so it is drawn once and copied, a frame then costing a few milliseconds instead of tens.
    const still = time <= moveFrom ? "start" : time >= moveTo ? "end" : null;
    const m = ctx.getTransform();
    const key = still && `${still}|${ctx.canvas.width}x${ctx.canvas.height}|${m.a},${m.b},${m.c},${m.d},${m.e},${m.f}`;
    const kept = key ? bases.get(key) : undefined;
    if (kept) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(kept, 0, 0);
      ctx.restore();
    } else {
      ctx.fillStyle = c.paper;
      ctx.fillRect(0, 0, f.width, f.height);
      ctx.beginPath();
      path2d({ type: "Sphere" });
      ctx.fillStyle = c.sphere;
      ctx.fill();
      ctx.beginPath();
      path2d(GRATICULE);
      ctx.strokeStyle = c.grid;
      ctx.lineWidth = 1 * u;
      ctx.stroke();
      // Only the land this view can show.
      const halfDiag = Math.hypot(f.width, f.height) / 2 / v.r;
      const reach = halfDiag >= 1 ? Math.PI / 2 : Math.asin(halfDiag) + 0.05;
      ctx.beginPath();
      for (const cap of caps) if (geoDistance(cap.centre, v.centre) - cap.radius < reach) path2d(cap.feature);
      ctx.fillStyle = c.land;
      ctx.fill();
      ctx.strokeStyle = c.landEdge;
      ctx.lineWidth = 0.8 * u;
      ctx.stroke();
      if (key) {
        const copy = document.createElement("canvas");
        copy.width = ctx.canvas.width;
        copy.height = ctx.canvas.height;
        copy.getContext("2d")!.drawImage(ctx.canvas, 0, 0);
        for (const k of bases.keys()) if (k.startsWith(`${still}|`)) bases.delete(k);
        bases.set(key, copy);
      }
    }

    // The great circle for reference, in faint dots that keep their place on the ground.
    ctx.fillStyle = c.gap;
    ctx.globalAlpha = 0.7;
    for (const p of refDots) {
      if (!visible(p)) continue;
      const xy = proj(p);
      if (!xy) continue;
      ctx.beginPath();
      ctx.arc(xy[0], xy[1], 1.4 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // The way flown so far: recorded stretches in gold on a paper halo, the rest in grey dots.
    const s = progress(time);
    const here = along(path, s);
    const runs: [number, number][][] = [];
    let run: [number, number][] = [];
    const flush = () => {
      if (run.length > 1) runs.push(run);
      run = [];
    };
    for (let j = 0; j <= here.i && j < path.gap.length; j++) {
      const a = path.at[j]!;
      const b = j === here.i ? here.at : path.at[j + 1]!;
      const xa = visible(a) ? proj(a) : null;
      const xb = visible(b) ? proj(b) : null;
      if (path.gap[j] || !xa || !xb) {
        flush();
        continue;
      }
      if (!run.length) run.push(xa as [number, number]);
      run.push(xb as [number, number]);
    }
    flush();
    for (const [colour, width] of [[c.paper, 9], [c.flown, 4.5]] as const) {
      ctx.beginPath();
      for (const r of runs) {
        ctx.moveTo(r[0]![0], r[0]![1]);
        for (let k = 1; k < r.length; k++) ctx.lineTo(r[k]![0], r[k]![1]);
      }
      ctx.strokeStyle = colour;
      ctx.lineWidth = width * u;
      ctx.globalAlpha = colour === c.paper ? 0.85 : 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Unrecorded stretches: dots every few kilometres along the way, up to the aircraft.
    ctx.fillStyle = c.gap;
    for (let i = 0; i <= here.i && i < path.gap.length; i++) {
      if (!path.gap[i]) continue;
      const a = path.km[i]!;
      const b = i === here.i ? s : path.km[i + 1]!;
      for (let k = Math.ceil(a / gapStep) * gapStep; k <= b; k += gapStep) {
        const p = along(path, k).at;
        if (!visible(p)) continue;
        const xy = proj(p);
        if (!xy) continue;
        ctx.beginPath();
        ctx.arc(xy[0], xy[1], 2.4 * u, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // The airports, and a ring at the arrival as the aircraft lands.
    for (const e of ends) {
      if (!visible(e.at)) continue;
      const xy = proj(e.at);
      if (!xy) continue;
      ctx.beginPath();
      ctx.arc(xy[0], xy[1], 7 * u, 0, Math.PI * 2);
      ctx.fillStyle = c.paper;
      ctx.fill();
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = 2.5 * u;
      ctx.stroke();
      const w = measure(e.code, 24 * u, 700);
      drawCode(ctx, f, e.code, e.right ? [xy[0] + e.dx, 0, xy[0] + e.dx + w, 0] : [xy[0] - e.dx - w, 0, xy[0] - e.dx, 0], xy[1], 1);
    }
    const since = time - landedAt;
    if (since >= 0 && since < 1.1 && visible(leg.to)) {
      const xy = proj(leg.to);
      if (xy) {
        const k = easeOut(since / 1.1);
        ctx.globalAlpha = 0.55 * (1 - k);
        ctx.beginPath();
        ctx.arc(xy[0], xy[1], (9 + 30 * k) * u, 0, Math.PI * 2);
        ctx.strokeStyle = c.flown;
        ctx.lineWidth = 2.5 * u;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // The aircraft, seen from above, turned the way it goes on the screen (over a stretch either side, so a wobble in
    // the recorded positions does not shake it).
    // Once landed it fades, leaving the arrival's dot and code to read.
    const shown = 1 - smoother((time - landedAt - 0.3) / 0.8);
    if (visible(here.at) && shown > 0) {
      const xy = proj(here.at)!;
      const d = Math.max(3, path.total * 0.006);
      const behind = proj(along(path, s - d).at);
      const ahead = proj(along(path, s + d).at);
      const angle = behind && ahead && Math.hypot(ahead[0] - behind[0], ahead[1] - behind[1]) > 0.01 ? Math.atan2(ahead[0] - behind[0], -(ahead[1] - behind[1])) : 0;
      const size = 40 * u;
      ctx.save();
      ctx.globalAlpha = shown;
      ctx.translate(xy[0], xy[1]);
      ctx.rotate(angle);
      ctx.scale(size / 24, size / 24);
      ctx.translate(-12, -12);
      ctx.lineWidth = (5 * u * 24) / size;
      ctx.strokeStyle = c.paper;
      ctx.stroke(plane);
      ctx.fillStyle = c.ink;
      ctx.fill(plane);
      ctx.restore();
    }

    drawTop(ctx, f, content.title);
    if (content.subtitle) text(ctx, content.subtitle, 64 * u, 132 * u, { size: 28 * u, weight: 400, fill: c.ink2, maxWidth: f.width - 128 * u });

    // The figures: as recorded where the aircraft is, then the flight's statistics once it has landed.
    if (live || summary) {
      const swap = summary ? clamp((time - landedAt - 0.5) / 0.9, 0, 1) : 0;
      drawTileSwap(ctx, f, live ? { tiles: live, values: readout(s) } : null, summary ? { tiles: summary, values: content.stats! } : null, live ? swap : 1);
    }
  };

  return { width: f.width, height: f.height, duration, draw };
}

/** The scene for a video's content. Call `prepareVideo` first, for the fine land and the typeface. */
export function makeScene(content: VideoContent, o: VideoOptions): Scene {
  return content.kind === "flight" && content.legs.length ? flightScene(content, o) : periodScene(content, o);
}

/** The length a video starts with: a flight's 15 seconds, a period's longer the more flights it has. */
export function defaultSeconds(content: VideoContent): number {
  if (content.kind === "flight") return 15;
  const n = content.legs.length + new Set((content.sightings ?? []).map((s) => `${s.placeId}|${s.day}`)).size;
  return n <= 8 ? 15 : n <= 40 ? 30 : n <= 150 ? 45 : 60;
}

// ——— Encoding ———

export type VideoCodec = "avc" | "vp9";

/** H.264's level for a size and rate: the lowest whose frame size and macroblock rate it allows. */
function avcLevel(width: number, height: number, fps: number): number {
  const frame = Math.ceil(width / 16) * Math.ceil(height / 16);
  const rate = frame * fps;
  const levels: [number, number, number][] = [
    [0x1f, 3600, 108000],
    [0x20, 5120, 216000],
    [0x28, 8192, 245760],
    [0x2a, 8704, 522240],
    [0x32, 22080, 589824],
    [0x33, 36864, 983040],
    [0x34, 36864, 2073600],
  ];
  return (levels.find(([, fs, mbps]) => frame <= fs && rate <= mbps) ?? levels[levels.length - 1]!)[0];
}

/** The encoder settings to use: H.264 (High, Main, then Baseline profile), else VP9; null when the browser has none. */
export async function chooseCodec(width: number, height: number, fps: number): Promise<{ config: VideoEncoderConfig; codec: VideoCodec } | null> {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return null;
  const level = avcLevel(width, height, fps).toString(16).padStart(2, "0").toUpperCase();
  // Flat colours and thin lines: about a tenth of a bit a pixel keeps the lines clean without a large file.
  const bitrate = Math.round(clamp(width * height * fps * 0.1, 4e6, 24e6));
  const candidates: [string, VideoCodec][] = [
    [`avc1.6400${level}`, "avc"],
    [`avc1.4D00${level}`, "avc"],
    [`avc1.42E0${level}`, "avc"],
    ["vp09.00.41.08", "vp9"],
    ["vp09.00.40.08", "vp9"],
  ];
  for (const [codec, kind] of candidates) {
    const config: VideoEncoderConfig = { codec, width, height, bitrate, framerate: fps, latencyMode: "quality", ...(kind === "avc" ? { avc: { format: "avc" } } : {}) };
    try {
      const s = await VideoEncoder.isConfigSupported(config);
      if (s.supported) return { config, codec: kind };
    } catch {
      /* not this one */
    }
  }
  return null;
}

/** This browser cannot encode video at the size and rate chosen. */
export class VideoUnsupported extends Error {
  constructor() {
    super("No video encoder for this size and rate");
    this.name = "VideoUnsupported";
  }
}

/** Give the page a moment to show progress and answer input, without the 4ms a nested timer is held back. */
function yieldToPage(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (s?.yield) return s.yield();
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(null);
  });
}

const bytesOf = (b: AllowSharedBufferSource | undefined): Uint8Array | null => {
  if (!b) return null;
  if (b instanceof ArrayBuffer) return new Uint8Array(b.slice(0));
  const v = b as ArrayBufferView;
  return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) as ArrayBuffer);
};

/**
 * The video as an MP4 file: each frame drawn at its own time and encoded, `progress` told how far it has got (0 to 1).
 * Stops with an AbortError when `signal` is aborted.
 */
export async function makeVideo(content: VideoContent, o: VideoOptions & { fps: number }, progress: (done: number) => void, signal?: AbortSignal): Promise<Blob> {
  await prepareVideo(content);
  const chosen = await chooseCodec(o.width, o.height, o.fps);
  if (!chosen) throw new VideoUnsupported();
  const scene = makeScene(content, o);
  const canvas = document.createElement("canvas");
  canvas.width = o.width;
  canvas.height = o.height;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const fps = o.fps;
  const total = Math.max(1, Math.round(o.seconds * fps));
  const samples: Mp4Sample[] = [];
  let decoder: VideoDecoderConfig | null = null;
  let failure: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (meta?.decoderConfig) decoder = meta.decoderConfig;
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push({ data, key: chunk.type === "key", frame: Math.round((chunk.timestamp * fps) / 1e6) });
    },
    error: (e) => {
      failure = e;
    },
  });
  encoder.configure(chosen.config);
  const aborted = () => new DOMException("Stopped", "AbortError");
  try {
    let last = performance.now();
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw aborted();
      if (failure) throw failure;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      scene.draw(ctx, i / fps);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      // A key frame every two seconds, so a player can start anywhere.
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 4) {
        if (failure) throw failure;
        await new Promise((r) => setTimeout(r, 1));
      }
      if (performance.now() - last > 50) {
        progress(i / total);
        await yieldToPage();
        last = performance.now();
      }
    }
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
  progress(1);
  const d = decoder as VideoDecoderConfig | null;
  return mp4({ codec: d?.codec ?? chosen.config.codec, width: o.width, height: o.height, fps, description: bytesOf(d?.description), colour: d?.colorSpace ?? null }, samples);
}
