// A map as an image (requirement F4, docs/23-tracks-and-maps.md, "Export: figure"): a flight, a period's flights or a
// whole log drawn with d3-geo on Natural Earth land, as the app's maps draw them, with its title, its statistics if
// chosen and the Touchdown logo. One layout, painted on a canvas (PNG, JPEG, WebP, and a PDF made from a JPEG) or
// written as SVG. The same picture, without words, is a share link's preview (docs/32, "Previews"). Nothing is sent
// anywhere from here.

import { geoAzimuthalEqualArea, geoBounds, geoDistance, geoEqualEarth, geoGraticule10, geoOrthographic, geoPath, type GeoPermissibleObjects, type GeoProjection } from "d3-geo";
import type { FeatureCollection, Geometry } from "geojson";
import { feature } from "topojson-client";
import { t } from "@touchdown/i18n";
import { centralMeridian, globeCentre, LAND, routeSamplesOf, type LonLat, type MapFlight } from "../components/maps.tsx";
import { AIRLINER, AIRLINER_TRANSFORM, GROUND } from "./wordmark.ts";
import { pdfOfJpeg } from "./pdf.ts";

export type FigureFormat = "png" | "jpeg" | "webp" | "svg" | "pdf";
export type FigureSize = "landscape" | "square" | "portrait" | "a4" | "a3";
export type FigureTheme = "light" | "dark";

/** The sizes offered, in pixels, and the resolution a PDF of each is printed at (A4 and A3 landscape at 300 dpi). */
export const FIGURE_SIZES: Record<FigureSize, { width: number; height: number; dpi: number }> = {
  landscape: { width: 1920, height: 1080, dpi: 144 },
  square: { width: 1080, height: 1080, dpi: 144 },
  portrait: { width: 1080, height: 1920, dpi: 144 },
  a4: { width: 3508, height: 2480, dpi: 300 },
  a3: { width: 4961, height: 3508, dpi: 300 },
};

export const FIGURE_FORMATS: Record<FigureFormat, { ext: string; type: string }> = {
  png: { ext: "png", type: "image/png" },
  jpeg: { ext: "jpg", type: "image/jpeg" },
  webp: { ext: "webp", type: "image/webp" },
  svg: { ext: "svg", type: "image/svg+xml" },
  pdf: { ext: "pdf", type: "application/pdf" },
};

/** A spotting place: a blue dot, sized by the aircraft seen there, as the app's maps draw it. */
export interface FigureSpot {
  at: LonLat;
  code: string;
  /** Aircraft seen there; one when not given. */
  aircraft?: number;
}

/** One figure of the statistics: "Time in the air", "72h 05m", "across 14 flights". */
export interface FigureStat {
  label: string;
  value: string;
  detail?: string;
}

/** What a figure shows, whatever its size, theme and format. */
export interface FigureContent {
  flights: MapFlight[];
  /** Spotting places, drawn as blue dots under the airports' dots. */
  spots?: FigureSpot[];
  /** Words over the map's top left: a title and a line under it. */
  title?: string;
  subtitle?: string;
  /** Figures in a band under the map, left of the logo. */
  stats?: FigureStat[];
}

export interface Figure extends FigureContent {
  width: number;
  height: number;
  theme: FigureTheme;
}

/** The least a figure shows, in degrees, so a short flight or one place has its region around it. */
const MIN_SPAN = 8;

/**
 * A globe only when everything is within this angle (radians, 60°) of its centre. The app's maps turn a globe to
 * any hemisphere, but a still picture shows places near the globe's edge squeezed, so a wider spread goes flat.
 */
const GLOBE_REACH = Math.PI / 3;

/** At most this many places get their codes written: more would cover each other and the routes. */
export const MAX_LABELS = 10;

/** The app's map colours (app.css), for each theme: a figure looks the same whatever the page's theme is now. */
export const COLOURS = {
  light: { paper: "#faf8f1", sphere: "#f4f1e8", land: "#e6e0d1", landEdge: "#f6f3eb", grid: "rgba(31, 29, 26, 0.05)", flown: "#c48400", spotted: "#4559a9", gap: "#bdb5a3", ink: "#1f1d1a", ink2: "#534e46", ink3: "#6e685e" },
  dark: { paper: "#171613", sphere: "#1d1c19", land: "#2a2823", landEdge: "#171613", grid: "rgba(241, 238, 230, 0.06)", flown: "#c48400", spotted: "#788ce0", gap: "#5b574d", ink: "#f1eee6", ink2: "#c8c2b5", ink3: "#a19b8e" },
};
export type Colours = (typeof COLOURS)["light"];

/** The page's typeface and, for Chinese, the system's Chinese face after it (app.css `--sans`). */
export const sans = () => getComputedStyle(document.documentElement).getPropertyValue("--sans").trim() || "system-ui, sans-serif";

/**
 * Words as a page sets them: a narrow gap (a hair space, about an eighth of a character) between Chinese characters
 * and Latin letters or figures, which a page gets from CSS `text-autospace` and a canvas or SVG does not. A word joiner
 * (a date's "2026⁠年") keeps it out, as on the page.
 */
export const spaced = (text: string) => text.replace(/(\p{Script=Han})(?=[A-Za-z0-9])|([A-Za-z0-9])(?=\p{Script=Han})/gu, "$1$2\u200a");

// ——— Land ———

let fine: FeatureCollection | null = null;
let fineLoading: Promise<FeatureCollection> | null = null;

/**
 * Natural Earth at 1:50m, finer than the app's maps (1:110m), so coastlines stay smooth close up and in print.
 * Loaded the first time an image is made. Without it (offline before it was ever loaded) the app's own land is used.
 */
export function loadLand(): Promise<FeatureCollection> {
  fineLoading ??= import("world-atlas/countries-50m.json").then(
    (m) => {
      const world = m.default as unknown as Parameters<typeof feature>[0];
      fine = feature(world, (world as unknown as { objects: Record<string, Parameters<typeof feature>[1]> }).objects.countries!) as unknown as FeatureCollection;
      return fine;
    },
    () => {
      fineLoading = null;
      return LAND;
    },
  );
  return fineLoading;
}

/** The land figures and videos draw: the fine one once loaded, else the app's own. */
export const landNow = (): FeatureCollection => fine ?? LAND;

/** Every word a figure writes, for the typeface's files its characters need. */
function wordsOf(f: FigureContent): string {
  const stats = (f.stats ?? []).flatMap((x) => [x.label, x.value, x.detail ?? ""]);
  const codes = [...f.flights.flatMap((x) => [x.fromCode, x.toCode]), ...(f.spots ?? []).map((x) => x.code)];
  return spaced([f.title ?? "", f.subtitle ?? "", ...stats, ...codes, "Touchdown"].join(" "));
}

/**
 * The typeface's weights the figure draws with, with the files its words' characters need, loaded: a canvas does not
 * wait for them. Chinese comes in files of a few hundred characters each (app.css), so the words decide which.
 */
export async function loadFonts(words: string): Promise<void> {
  const stack = sans();
  await Promise.all(["400", "600", "700"].map((w) => document.fonts?.load(`${w} 24px ${stack}`, words || " ").catch(() => [])));
}

/** Everything a figure needs before it is drawn: the fine land, and the typeface for its words. */
export async function prepareFigure(content?: FigureContent): Promise<void> {
  await Promise.all([loadLand(), loadFonts(content ? wordsOf(content) : " ")]);
}

// ——— Painting ———

interface Stroke {
  fill?: string;
  stroke?: string;
  width?: number;
  dash?: number[];
  alpha?: number;
}

interface Words {
  size: number;
  weight: number;
  fill: string;
  halo?: { colour: string; width: number };
  align?: "left" | "right";
  maxWidth?: number;
  letterSpacing?: number;
}

/** What the layout asks of a canvas or of SVG. Text is always set on its alphabetic baseline. */
interface Painter {
  use(proj: GeoProjection): void;
  rect(x: number, y: number, w: number, h: number, fill: string): void;
  /** A full-width rectangle from `clear` (transparent) to `solid` (the colour), and solid beyond it to `end`. */
  fade(clear: number, solid: number, end: number, colour: string): void;
  geo(objects: GeoPermissibleObjects[], s: Stroke): void;
  circle(x: number, y: number, r: number, s: Stroke): void;
  text(text: string, x: number, y: number, w: Words): void;
  /** The wordmark's mark (lib/wordmark.ts), the top left of its viewBox at x, y, `scale` pixels to a unit. */
  mark(x: number, y: number, scale: number, ink: string, gold: string, halo: string): void;
}

let measurer: CanvasRenderingContext2D | null = null;
export function measure(text: string, size: number, weight: number, letterSpacing = 0): number {
  measurer ??= document.createElement("canvas").getContext("2d")!;
  measurer.font = `${weight} ${size}px ${sans()}`;
  return measurer.measureText(spaced(text)).width + letterSpacing * [...text].length;
}

/** AIRLINER_TRANSFORM, "translate(x y) rotate(deg cx cy)", for a canvas. */
function airlinerTransform(): { tx: number; ty: number; deg: number; cx: number; cy: number } {
  const tr = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(AIRLINER_TRANSFORM);
  const ro = /rotate\(([-\d.]+)[ ,]+([-\d.]+)[ ,]+([-\d.]+)\)/.exec(AIRLINER_TRANSFORM);
  return { tx: Number(tr?.[1] ?? 0), ty: Number(tr?.[2] ?? 0), deg: Number(ro?.[1] ?? 0), cx: Number(ro?.[2] ?? 0), cy: Number(ro?.[3] ?? 0) };
}
const GROUND_ENDS = /M([-\d.]+) ([-\d.]+)H([-\d.]+)/.exec(GROUND)!.slice(1).map(Number) as [number, number, number];

/** The wordmark's mark on a canvas, the top left of its viewBox at x, y, `scale` pixels to a unit. */
export function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, ink: string, gold: string, halo: string) {
  const a = airlinerTransform();
  const [x1, gy, x2] = GROUND_ENDS;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.translate(-2, -6);
  for (const [colour, width] of [[halo, 4.4], [gold, 2.4]] as const) {
    ctx.beginPath();
    ctx.moveTo(x1, gy);
    ctx.lineTo(x2, gy);
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.stroke();
  }
  ctx.translate(a.tx, a.ty);
  ctx.translate(a.cx, a.cy);
  ctx.rotate((a.deg * Math.PI) / 180);
  ctx.translate(-a.cx, -a.cy);
  const plane = new Path2D(AIRLINER);
  ctx.strokeStyle = halo;
  ctx.lineWidth = 2;
  ctx.stroke(plane);
  ctx.fillStyle = ink;
  ctx.fill(plane);
  ctx.restore();
}

class CanvasPainter implements Painter {
  private path: ReturnType<typeof geoPath> | null = null;
  constructor(private ctx: CanvasRenderingContext2D) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }
  use(proj: GeoProjection) {
    this.path = geoPath(proj, this.ctx);
  }
  rect(x: number, y: number, w: number, h: number, fill: string) {
    this.ctx.fillStyle = fill;
    this.ctx.fillRect(x, y, w, h);
  }
  fade(clear: number, solid: number, end: number, colour: string) {
    const g = this.ctx.createLinearGradient(0, clear, 0, solid);
    g.addColorStop(0, `${colour}00`);
    g.addColorStop(1, colour);
    this.ctx.fillStyle = g;
    this.ctx.fillRect(0, Math.min(clear, solid), this.ctx.canvas.width, Math.abs(solid - clear));
    this.rect(0, Math.min(solid, end), this.ctx.canvas.width, Math.abs(end - solid), colour);
  }
  private paint(s: Stroke) {
    const ctx = this.ctx;
    ctx.globalAlpha = s.alpha ?? 1;
    if (s.fill) {
      ctx.fillStyle = s.fill;
      ctx.fill();
    }
    if (s.stroke) {
      ctx.setLineDash(s.dash ?? []);
      ctx.strokeStyle = s.stroke;
      ctx.lineWidth = s.width ?? 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }
  geo(objects: GeoPermissibleObjects[], s: Stroke) {
    this.ctx.beginPath();
    for (const o of objects) this.path!(o);
    this.paint(s);
  }
  circle(x: number, y: number, r: number, s: Stroke) {
    this.ctx.beginPath();
    this.ctx.arc(x, y, r, 0, Math.PI * 2);
    this.paint(s);
  }
  text(words: string, x: number, y: number, w: Words) {
    const ctx = this.ctx;
    const text = spaced(words);
    ctx.font = `${w.weight} ${w.size}px ${sans()}`;
    ctx.letterSpacing = `${w.letterSpacing ?? 0}px`;
    ctx.textAlign = w.align ?? "left";
    ctx.textBaseline = "alphabetic";
    if (w.halo) {
      ctx.lineWidth = w.halo.width;
      ctx.strokeStyle = w.halo.colour;
      ctx.strokeText(text, x, y, w.maxWidth);
    }
    ctx.fillStyle = w.fill;
    ctx.fillText(text, x, y, w.maxWidth);
    ctx.letterSpacing = "0px";
    ctx.textAlign = "left";
  }
  mark(x: number, y: number, scale: number, ink: string, gold: string, halo: string) {
    drawMark(this.ctx, x, y, scale, ink, gold, halo);
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (x: number) => String(Math.round(x * 10) / 10);

class SvgPainter implements Painter {
  readonly out: string[] = [];
  private path: ReturnType<typeof geoPath> | null = null;
  private fades = 0;
  constructor(private width: number) {}
  use(proj: GeoProjection) {
    this.path = geoPath(proj).digits(1);
  }
  rect(x: number, y: number, w: number, h: number, fill: string) {
    this.out.push(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${fill}"/>`);
  }
  fade(clear: number, solid: number, end: number, colour: string) {
    const id = `fade${this.fades++}`;
    const down = solid > clear;
    this.out.push(
      `<defs><linearGradient id="${id}" x1="0" y1="${down ? 0 : 1}" x2="0" y2="${down ? 1 : 0}"><stop offset="0" stop-color="${colour}" stop-opacity="0"/><stop offset="1" stop-color="${colour}"/></linearGradient></defs>`,
      `<rect x="0" y="${n(Math.min(clear, solid))}" width="${n(this.width)}" height="${n(Math.abs(solid - clear))}" fill="url(#${id})"/>`,
    );
    this.rect(0, Math.min(solid, end), this.width, Math.abs(end - solid), colour);
  }
  private attrs(s: Stroke): string {
    return [
      `fill="${s.fill ?? "none"}"`,
      s.stroke ? `stroke="${s.stroke}" stroke-width="${n(s.width ?? 1)}" stroke-linecap="round" stroke-linejoin="round"` : "",
      s.dash?.length ? `stroke-dasharray="${s.dash.map(n).join(" ")}"` : "",
      s.alpha !== undefined && s.alpha < 1 ? `opacity="${s.alpha}"` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  geo(objects: GeoPermissibleObjects[], s: Stroke) {
    const d = objects.map((o) => this.path!(o) ?? "").join("");
    if (d) this.out.push(`<path d="${d}" ${this.attrs(s)}/>`);
  }
  circle(x: number, y: number, r: number, s: Stroke) {
    this.out.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" ${this.attrs(s)}/>`);
  }
  text(words: string, x: number, y: number, w: Words) {
    const text = spaced(words);
    const width = measure(words, w.size, w.weight, w.letterSpacing);
    const squeeze = w.maxWidth && width > w.maxWidth ? ` textLength="${n(w.maxWidth)}" lengthAdjust="spacingAndGlyphs"` : "";
    const halo = w.halo ? ` stroke="${w.halo.colour}" stroke-width="${n(w.halo.width)}" stroke-linejoin="round" paint-order="stroke"` : "";
    const spacing = w.letterSpacing ? ` letter-spacing="${n(w.letterSpacing)}"` : "";
    this.out.push(
      `<text x="${n(x)}" y="${n(y)}" font-size="${n(w.size)}" font-weight="${w.weight}" fill="${w.fill}"${w.align === "right" ? ' text-anchor="end"' : ""}${spacing}${halo}${squeeze}>${esc(text)}</text>`,
    );
  }
  mark(x: number, y: number, scale: number, ink: string, gold: string, halo: string) {
    this.out.push(
      `<g transform="translate(${n(x)} ${n(y)}) scale(${scale.toFixed(3)}) translate(-2 -6)">`,
      `<path d="${GROUND}" stroke="${halo}" stroke-width="4.4" stroke-linecap="round"/>`,
      `<path d="${GROUND}" stroke="${gold}" stroke-width="2.4" stroke-linecap="round"/>`,
      `<path transform="${AIRLINER_TRANSFORM}" d="${AIRLINER}" fill="${ink}" stroke="${halo}" stroke-width="2" paint-order="stroke"/>`,
      `</g>`,
    );
  }
}

// ——— Layout ———

export type Box = [number, number, number, number];
export const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** The figure's places, each once: its flights' airports and its spots. */
function placesOf(f: FigureContent): Map<string, FigureSpot> {
  const places = new Map<string, FigureSpot>();
  for (const x of f.flights) {
    places.set(`${x.from[0]},${x.from[1]}`, { at: x.from, code: x.fromCode });
    places.set(`${x.to[0]},${x.to[1]}`, { at: x.to, code: x.toCode });
  }
  for (const s of f.spots ?? []) places.set(`${s.at[0]},${s.at[1]}`, { at: s.at, code: s.code });
  return places;
}

/**
 * The projection: a globe centred on what is shown when it fits well within one hemisphere, else Equal Earth around
 * it. In an upright picture, where a flat world would be a strip, a disc centred on what is shown instead, as the
 * app's maps on phones draw it (azimuthal equal-area, DESIGN.md "Maps under 600px wide").
 */
export function projectionFor(f: Figure, area: [[number, number], [number, number]]): { proj: GeoProjection; globe: boolean } {
  const samples = f.flights.flatMap(routeSamplesOf);
  const points: LonLat[] = [...samples, ...f.flights.flatMap((x) => [x.from, x.to]), ...(f.spots ?? []).map((s) => s.at)];
  const geoms: Geometry[] = [...f.flights.map((x) => ({ type: "MultiLineString" as const, coordinates: [...x.line, ...(x.gaps ?? [])] })), ...(f.spots ?? []).map((s) => ({ type: "Point" as const, coordinates: s.at }))];
  const fc: FeatureCollection = { type: "FeatureCollection", features: geoms.map((geometry) => ({ type: "Feature", geometry, properties: {} })) };
  const clip = (proj: GeoProjection) => proj.clipExtent([[0, 0], [f.width, f.height]]);
  if (!points.length) {
    const proj = geoEqualEarth();
    proj.fitExtent(area, { type: "Sphere" });
    return { proj: clip(proj), globe: false };
  }
  const c = globeCentre(points);
  // One place or a short route has no extent to fit: a region around it.
  const [[w, s], [e, nth]] = geoBounds(fc);
  const lonSpan = (e - w + 360) % 360;
  const small = lonSpan < MIN_SPAN && nth - s < MIN_SPAN;
  const target = small
    ? { type: "MultiPoint" as const, coordinates: [[c.at[0] - MIN_SPAN, c.at[1] - MIN_SPAN / 2], [c.at[0] + MIN_SPAN, c.at[1] + MIN_SPAN / 2]] }
    : fc;
  if (points.every((p) => geoDistance(p, c.at) < GLOBE_REACH)) {
    const proj = geoOrthographic().rotate([-c.at[0], -c.at[1]]).clipAngle(90);
    proj.fitExtent(area, target as never);
    return { proj: clip(proj), globe: true };
  }
  if (f.width < f.height) {
    const proj = geoAzimuthalEqualArea().rotate([-c.at[0], -c.at[1]]).clipAngle(170);
    proj.fitExtent(area, target as never);
    return { proj: clip(proj), globe: true };
  }
  const proj = geoEqualEarth().rotate([-centralMeridian(f.flights.map(routeSamplesOf), points), 0]);
  proj.fitExtent(area, target as never);
  // Routes from east to west fill the width, and the world's edge may then leave paper above or below them in the
  // room. The world moves to cover the room as far as the routes stay in it, or sits in its middle when shorter.
  const [[, y0], [, y1]] = geoPath(proj).bounds({ type: "Sphere" });
  const [[, r0], [, r1]] = geoPath(proj).bounds(target as never);
  const [top, bottom] = [area[0][1], area[1][1]];
  let dy = 0;
  if (y1 - y0 < bottom - top) dy = (top + bottom) / 2 - (y0 + y1) / 2;
  else if (y0 > top) dy = -Math.min(y0 - top, r0 - top);
  else if (y1 < bottom) dy = Math.min(bottom - y1, bottom - r1);
  if (dy) {
    const [tx, ty] = proj.translate();
    proj.translate([tx, ty + dy]);
  }
  return { proj: clip(proj), globe: false };
}

/** The statistics' type: a label, the figure and a line under it, as the pages' figures are set, smaller. */
export const STAT = { label: 18, value: 34, detail: 17, gap: 44, rowGap: 22 };

/**
 * The statistics as a grid between `left` and `right`: as few rows as fit, the tiles shared evenly between them (seven
 * as four and three, never six and one), the first rows taking any one over. The columns share the room equally, as
 * the pages' figures do, or when a tile is wider than its share each column is as wide as its widest tile, so the
 * figures line up down the rows.
 */
export function statTiles(stats: FigureStat[], u: number, left: number, right: number) {
  const room = right - left;
  const gap = STAT.gap * u;
  const widths = stats.map((s) => Math.min(460 * u, Math.max(measure(s.label, STAT.label * u, 600), measure(s.value, STAT.value * u, 700), s.detail ? measure(s.detail, STAT.detail * u, 400) : 0)));
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  /** The tiles' indices in `count` rows, shared as evenly as they go. */
  const share = (count: number) => {
    const base = Math.floor(stats.length / count);
    const over = stats.length % count;
    let next = 0;
    return Array.from({ length: count }, (_, r) => Array.from({ length: base + (r < over ? 1 : 0) }, () => next++));
  };
  const columns = (rows: number[][]) => Array.from({ length: rows[0]?.length ?? 0 }, (_, j) => Math.max(...rows.filter((row) => j < row.length).map((row) => widths[row[j]!]!)));
  let rows = share(1);
  let colW = columns(rows);
  for (let count = 1; count <= stats.length; count++) {
    rows = share(count);
    colW = columns(rows);
    if (sum(colW) + gap * (colW.length - 1) <= room) break;
  }
  // Spread across the room in equal columns, as the pages' figures are, when every tile fits its share.
  const widest = Math.max(0, ...colW);
  const even = (room - gap * (colW.length - 1)) / colW.length;
  if (even >= widest) colW = colW.map(() => even);
  const xs = colW.map((_, j) => left + sum(colW.slice(0, j)) + j * gap);
  const detail = stats.some((s) => s.detail);
  const rowHeight = (detail ? 80 : 56) * u;
  return {
    rows: rows.map((row) => row.map((i, j) => ({ x: xs[j]!, w: Math.min(colW[j]!, right - xs[j]!), s: stats[i]! }))),
    rowHeight,
    rowGap: STAT.rowGap * u,
    height: rows.length * rowHeight + (rows.length - 1) * STAT.rowGap * u,
  };
}

/** The figure, painted: the map fitted between the title and the statistics, the routes, the places, the words. */
function lay(f: Figure, p: Painter, land: FeatureCollection) {
  const c: Colours = COLOURS[f.theme];
  // Sizes are for a landscape picture 1,200 wide. A square or upright one sets its words a fifth larger, as it is
  // seen smaller for its width (on a phone, in a feed).
  const u = f.width / (f.width / f.height >= 1.4 ? 1200 : 1000);
  p.rect(0, 0, f.width, f.height, c.paper);

  // The logo, at the bottom right: the mark and the name, as the top bar draws them (DESIGN.md, "Wordmark").
  const nameSize = 26 * u;
  const markH = (nameSize * 25) / 18;
  const markScale = markH / 20.5;
  const markW = 28 * markScale;
  const nameW = measure("Touchdown", nameSize, 600, -0.015 * nameSize);
  const logoW = markW + 13 * u + nameW;
  // With a title the logo sits at the end of the title's line, else at the bottom right over the map.
  const logoRight = f.width - (f.title ? 64 : 44) * u;
  const logoBottom = f.title ? 92 * u + 0.18 * markH : f.height - 36 * u;
  const logoBox: Box = [logoRight - logoW - 8 * u, logoBottom - markH - 8 * u, logoRight + 8 * u, logoBottom + 8 * u];

  // The statistics, in a band at the bottom left of the logo, and the title's band at the top.
  const tiles = f.stats?.length ? statTiles(f.stats, u, 64 * u, f.width - 64 * u) : null;
  const statsTop = tiles ? f.height - 44 * u - tiles.height : f.height;
  const band = f.title ? 150 * u : 0;
  const top = band + (f.title ? 20 : 48) * u;
  const bottom = tiles ? statsTop - 40 * u : f.height - (f.title ? 48 : 56) * u;
  const places = [...placesOf(f).values()];
  const labelled = places.length <= MAX_LABELS;
  const side = 64 * u + (labelled ? 72 * u : 0);
  const { proj, globe } = projectionFor(f, [[side, top], [f.width - side, bottom]]);
  p.use(proj);

  if (globe) p.geo([{ type: "Sphere" }], { fill: c.sphere });
  p.geo([geoGraticule10()], { stroke: c.grid, width: 1 * u });
  p.geo(land.features, { fill: c.land, stroke: c.landEdge, width: 0.8 * u });

  // Lines: a stretch not recorded in grey dots, what was recorded (or the great circle) in the flown colour,
  // thinner and lighter the more there are, so a whole log's routes stay apart.
  const count = f.flights.length;
  const line = count <= 12 ? { width: 4, alpha: 1 } : count <= 60 ? { width: 2.5, alpha: 0.8 } : { width: 1.6, alpha: 0.6 };
  for (const x of f.flights) if (x.gaps?.length) p.geo([{ type: "MultiLineString", coordinates: x.gaps }], { stroke: c.gap, width: Math.min(2.5, line.width) * u, dash: [2 * u, 6 * u] });
  p.geo(
    f.flights.map((x) => ({ type: "MultiLineString", coordinates: x.line })),
    { stroke: c.flown, width: line.width * u, alpha: line.alpha },
  );

  // Spotting places: blue dots with a paper ring, sized by the aircraft seen (4 to 13 at the most seen), the larger
  // under the smaller. Then airports: a dot each. Then the codes while there are few enough places to read them. A
  // code goes right of its dot, else left of it, and is left out where both would cover another code, a dot or the
  // words.
  const onImage = <T extends { at: LonLat }>(list: T[]) =>
    list.flatMap((pl) => {
      const xy = proj(pl.at);
      return xy && xy[0] >= 0 && xy[0] <= f.width && xy[1] >= 0 && xy[1] <= f.height ? [{ ...pl, xy }] : [];
    });
  const most = Math.max(1, ...(f.spots ?? []).map((sp) => sp.aircraft ?? 1));
  const spots = onImage([...(f.spots ?? [])].sort((a, b) => (b.aircraft ?? 1) - (a.aircraft ?? 1))).map((sp) => ({ ...sp, r: (4 + 9 * Math.sqrt((sp.aircraft ?? 1) / most)) * u }));
  for (const sp of spots) p.circle(sp.xy[0], sp.xy[1], sp.r, { fill: c.spotted, stroke: c.paper, width: 2 * u });
  const airports = onImage([...placesOf({ flights: f.flights }).values()]);
  const r = (labelled ? 7 : places.length > 60 ? 3 : 4) * u;
  for (const pl of airports) p.circle(pl.xy[0], pl.xy[1], r, { fill: c.paper, stroke: c.ink, width: (labelled ? 2.5 : 1.5) * u });
  if (labelled) {
    const size = 24 * u;
    const half = 14 * u;
    const shown = onImage(places);
    // The radius of the place's own dot, the larger where an airport is also a spotting place.
    const same = (a: LonLat, b: LonLat) => a[0] === b[0] && a[1] === b[1];
    const dot = (at: LonLat) => Math.max(airports.some((a) => same(a.at, at)) ? r : 0, spots.find((sp) => same(sp.at, at))?.r ?? 0);
    const taken: Box[] = [
      ...airports.map((pl): Box => [pl.xy[0] - r, pl.xy[1] - r, pl.xy[0] + r, pl.xy[1] + r]),
      ...spots.map((sp): Box => [sp.xy[0] - sp.r, sp.xy[1] - sp.r, sp.xy[0] + sp.r, sp.xy[1] + sp.r]),
      logoBox,
      [0, 0, f.width, band],
      [0, statsTop - 16 * u, f.width, f.height],
    ];
    for (const pl of shown) {
      const gap = dot(pl.at) + 6 * u;
      if (!pl.code || pl.code === "?") continue;
      const w = measure(pl.code, size, 700);
      const right: Box = [pl.xy[0] + gap, pl.xy[1] - half, pl.xy[0] + gap + w, pl.xy[1] + half];
      const left: Box = [pl.xy[0] - gap - w, pl.xy[1] - half, pl.xy[0] - gap, pl.xy[1] + half];
      const free = (b: Box) => b[0] >= 0 && b[2] <= f.width && !taken.some((tk) => overlaps(b, tk));
      const box = free(right) ? right : free(left) ? left : null;
      if (!box) continue;
      taken.push(box);
      p.text(pl.code, box[0], pl.xy[1] + 0.35 * size, { size, weight: 700, fill: c.ink, halo: { colour: c.paper, width: 6 * u } });
    }
  }

  // Words: the title and its line over the top left, on the paper colour fading into the map.
  if (f.title) {
    p.fade(band + 16 * u, band, 0, c.paper);
    p.text(f.title, 64 * u, 92 * u, { size: 52 * u, weight: 700, fill: c.ink, maxWidth: f.width - 128 * u - logoW - 40 * u });
    if (f.subtitle) p.text(f.subtitle, 64 * u, 132 * u, { size: 28 * u, weight: 400, fill: c.ink2, maxWidth: f.width - 128 * u });
  }

  // The statistics: a label, the figure and a line under it, as the pages' figures are set.
  if (tiles) {
    p.fade(statsTop - 36 * u, statsTop - 12 * u, f.height, c.paper);
    tiles.rows.forEach((row, i) => {
      const y = statsTop + i * (tiles.rowHeight + tiles.rowGap);
      for (const tile of row) {
        p.text(tile.s.label, tile.x, y + 15 * u, { size: STAT.label * u, weight: 600, fill: c.ink3, maxWidth: tile.w });
        p.text(tile.s.value, tile.x, y + 52 * u, { size: STAT.value * u, weight: 700, fill: c.ink, maxWidth: tile.w });
        if (tile.s.detail) p.text(tile.s.detail, tile.x, y + 76 * u, { size: STAT.detail * u, weight: 400, fill: c.ink2, maxWidth: tile.w });
      }
    });
  }

  p.mark(logoRight - logoW, logoBottom - markH, markScale, c.ink, c.flown, c.paper);
  p.text("Touchdown", logoRight, logoBottom - markH / 2 + 0.36 * nameSize, { size: nameSize, weight: 600, fill: c.ink, align: "right", letterSpacing: -0.015 * nameSize, halo: { colour: c.paper, width: 5 * u } });
}

// ——— Output ———

/** Draw a figure on a new canvas. Call `prepareFigure` first, for the fine land and the typeface. */
export function drawFigure(f: Figure): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(f.width);
  canvas.height = Math.round(f.height);
  lay(f, new CanvasPainter(canvas.getContext("2d")!), fine ?? LAND);
  return canvas;
}

/** A unicode-range ("U+4e00-4e3f,U+5b57") as pairs of code points. */
const rangesOf = (list: string) =>
  list.split(",").map((part) => {
    const [a, b] = part.trim().replace(/^U\+/i, "").split("-");
    return [parseInt(a!.replace(/\?/g, "0"), 16), parseInt((b ?? a!).replace(/\?/g, "f"), 16)] as const;
  });

const fileCache = new Map<string, Promise<string>>();

/**
 * The page's own @font-face rules for the typefaces it sets words in (Source Sans 3, and Source Han Sans for Chinese)
 * whose characters the SVG's words use, each with its file inside, so an SVG shows its words as the app does on any
 * computer. Only those files: Chinese has some hundred of them, of which a title needs a few.
 */
async function svgFonts(words: string): Promise<string> {
  const points = new Set([...words].map((ch) => ch.codePointAt(0)!));
  // Only the typefaces the language's own list names: Simplified Chinese's, not Traditional's too.
  const stack = sans();
  const named = (family: string) => stack.includes(family.replace(/^["']|["']$/g, ""));
  const rules: CSSFontFaceRule[] = [];
  for (const sheet of document.styleSheets) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      continue; // another site's stylesheet
    }
    for (const rule of list) if (rule instanceof CSSFontFaceRule && named(rule.style.getPropertyValue("font-family"))) rules.push(rule);
  }
  const needed = rules.filter((rule) => {
    if (rule.style.getPropertyValue("font-style") === "italic") return false;
    const range = rule.style.getPropertyValue("unicode-range");
    const ranges = range ? rangesOf(range) : [[0, 0x10ffff] as const];
    return [...points].some((cp) => ranges.some(([a, b]) => cp >= a && cp <= b));
  });
  const faces = await Promise.all(
    needed.map(async (rule) => {
      const url = /url\(["']?([^"')]+)["']?\)/.exec(rule.style.getPropertyValue("src"))?.[1];
      if (!url) return "";
      const absolute = new URL(url, rule.parentStyleSheet?.href ?? document.baseURI).href;
      if (!fileCache.has(absolute)) fileCache.set(absolute, fetch(absolute).then(async (r) => (r.ok ? base64(new Uint8Array(await r.arrayBuffer())) : "")));
      const data = await fileCache.get(absolute)!.catch(() => "");
      if (!data) return "";
      const family = rule.style.getPropertyValue("font-family");
      const range = rule.style.getPropertyValue("unicode-range");
      return `@font-face{font-family:${family};font-weight:${rule.style.getPropertyValue("font-weight") || "400"};src:url(data:font/woff2;base64,${data}) format("woff2")${range ? `;unicode-range:${range}` : ""}}`;
    }),
  );
  return faces.join("");
}

/** A figure as SVG: the same layout, as shapes and text that stay sharp at any size. */
export async function figureSvg(f: Figure): Promise<string> {
  const p = new SvgPainter(f.width);
  lay(f, p, fine ?? LAND);
  const family = sans().replace(/"/g, "'");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f.width}" height="${f.height}" viewBox="0 0 ${f.width} ${f.height}" font-family="${esc(family)}">`,
    f.title ? `<title>${esc(f.title)}</title>` : "",
    `<style>${await svgFonts(wordsOf(f))}</style>`,
    ...p.out,
    `</svg>`,
  ].join("\n");
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const blobOf = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b && b.type === type ? resolve(b) : reject(new Error(t("flights.figure.failed")))), type, quality));

/** Whether this browser can write a canvas as this type (WebP is not everywhere). */
export function canEncode(type: string): boolean {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  return c.toDataURL(type).startsWith(`data:${type}`);
}

/** A figure as a file of the chosen format. A PDF's page is the image's size at `dpi`. */
export async function figureFile(f: Figure, format: FigureFormat, dpi = 144): Promise<Blob> {
  await prepareFigure(f);
  if (format === "svg") return new Blob([await figureSvg(f)], { type: "image/svg+xml" });
  const canvas = drawFigure(f);
  if (format === "png") return blobOf(canvas, "image/png");
  if (format === "webp") return blobOf(canvas, "image/webp", 0.92);
  const jpeg = await blobOf(canvas, "image/jpeg", format === "pdf" ? 0.95 : 0.92);
  if (format === "jpeg") return jpeg;
  return pdfOfJpeg(new Uint8Array(await jpeg.arrayBuffer()), canvas.width, canvas.height, dpi, f.title);
}

/** A figure as PNG (a share link's preview). */
export const figurePng = (f: Figure) => figureFile(f, "png");

/** The theme the page shows now: the one chosen in Settings (on the page's root), else the system's. */
export function pageTheme(): FigureTheme {
  const chosen = document.documentElement.getAttribute("data-theme");
  if (chosen === "light" || chosen === "dark") return chosen;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
