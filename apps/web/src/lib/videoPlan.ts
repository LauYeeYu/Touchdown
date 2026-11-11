// The timing and the camera of a video of the map (docs/23-tracks-and-maps.md, "Export: video"), as plain numbers:
// when each flight is drawn, when the date under the title changes, how the view moves. Nothing here draws. The
// rules keep the motion calm: every move starts and stops at rest, the view only widens, a zoom keeps in view what was
// shown, a flight's aircraft stays in view, and words change no faster than they can be read.

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Smootherstep: 0 to 1 with no jump in speed or in acceleration at either end. */
export const smoother = (x: number) => {
  const v = clamp(x, 0, 1);
  return v * v * v * (v * (v * 6 - 15) + 10);
};

/** Fast at first, settling at the end (a cubic): things that appear. */
export const easeOut = (x: number) => 1 - (1 - clamp(x, 0, 1)) ** 3;

/** A cubic that starts and ends at rest: lines being drawn, numbers that change. */
export const easeInOut = (x: number) => {
  const v = clamp(x, 0, 1);
  return v < 0.5 ? 4 * v * v * v : 1 - (-2 * v + 2) ** 3 / 2;
};

/**
 * Progress along a path at a steady speed with a gentle start and stop: the speed rises over the first `ramp` of the
 * time and falls over the last (smoothstep-shaped), and is constant between, as an aircraft's is in the cruise.
 */
export function ramped(x: number, ramp = 0.14): number {
  const v = clamp(x, 0, 1);
  const r = clamp(ramp, 0.001, 0.5);
  // The distance covered while speeding up over a span u of the ramp (speed 3u² − 2u³, its integral u³ − u⁴/2).
  const up = (u: number) => r * (u * u * u - (u * u * u * u) / 2);
  const total = 1 - r;
  if (v <= r) return up(v / r) / total;
  if (v >= 1 - r) return 1 - up((1 - v) / r) / total;
  return (r / 2 + (v - r)) / total;
}

// ——— A period's timeline ———

export interface Slot {
  /** Seconds into the video when the flight starts to be drawn, and how long it takes. */
  start: number;
  duration: number;
}

export interface Timeline {
  slots: Slot[];
  /** The seconds the drawing spans: [first start, last end]. */
  from: number;
  to: number;
}

const DAY = 86_400_000;

/**
 * When each event is drawn, in a span of the video (`span`, seconds). Events are in date order, `when` in ms (null when
 * undated: they come last). The time is shared out by the events, not by the calendar: the time from one event to the
 * next is the first one's share (`share`, 1 for a flight, less for a day of spotting), a little longer when weeks pass
 * before the next (up to a month). So a busy month takes its time, a quiet half year passes in a moment, and a trip's
 * flights keep their order with room to be seen: each gets at least `floor` seconds, and connecting flights are drawn
 * one after the other. `weight` (0 to 1, by distance) makes a long flight a little slower to draw than a short one.
 */
export function timeline(when: (number | null)[], weight: number[], span: [number, number], share: number[] = when.map(() => 1)): Timeline {
  const n = when.length;
  const [a, b] = span;
  const room = Math.max(0.5, b - a);
  if (!n) return { slots: [], from: a, to: a };
  // How long a flight takes to draw: longer when there are few, so each can be followed; shorter when there are many.
  const each = room / n;
  const base = clamp(0.5 + 1.2 * each, 0.7, 1.8);
  const durations = weight.map((w) => base * (0.8 + 0.35 * clamp(w, 0, 1)));
  const last = durations[n - 1]!;
  const spread = Math.max(0, room - last);
  if (n === 1) return { slots: [{ start: a, duration: Math.min(durations[0]!, room) }], from: a, to: a + Math.min(durations[0]!, room) };
  const gaps: number[] = [];
  for (let i = 1; i < n; i++) {
    const p = when[i - 1];
    const q = when[i];
    const days = p === null || p === undefined || q === null || q === undefined ? 7 : Math.max(0, (q - p) / DAY);
    gaps.push(clamp(share[i - 1] ?? 1, 0.05, 1) * (0.6 + 0.4 * clamp(Math.log1p(days) / Math.log1p(30), 0, 1)));
  }
  const floor = Math.min(0.6 * base, (0.6 * spread) / (n - 1));
  const free = Math.max(0, spread - floor * (n - 1));
  const sum = gaps.reduce((s, g) => s + g, 0);
  const slots: Slot[] = [];
  let t = a;
  for (let i = 0; i < n; i++) {
    slots.push({ start: t, duration: durations[i]! });
    if (i < n - 1) t += floor + (sum > 0 ? (free * gaps[i]!) / sum : free / (n - 1));
  }
  const to = Math.max(...slots.map((s) => s.start + s.duration));
  return { slots, from: a, to };
}

/**
 * The words a ticker shows over time, from `label(t)` sampled every `step` seconds between `from` and `to`, changing
 * at most every `gap` seconds: a change that comes sooner waits, and only the latest of those waiting is shown.
 */
export function tickerChanges(label: (t: number) => string, from: number, to: number, step = 0.02, gap = 0.45): { t: number; text: string }[] {
  const out: { t: number; text: string }[] = [{ t: from, text: label(from) }];
  let pending: { t: number; text: string } | null = null;
  for (let t = from + step; t <= to + step / 2; t += step) {
    const text = label(t);
    const shown: string = pending?.text ?? out[out.length - 1]!.text;
    if (text !== shown) pending = { t, text };
    if (pending && t - out[out.length - 1]!.t >= gap) {
      if (pending.text !== out[out.length - 1]!.text) out.push({ t: Math.max(pending.t, out[out.length - 1]!.t + gap), text: pending.text });
      pending = null;
    }
  }
  if (pending && pending.text !== out[out.length - 1]!.text) out.push({ t: out[out.length - 1]!.t + gap, text: pending.text });
  return out;
}

// ——— The camera of a flat map ———

/** A rectangle: [left, top, right, bottom]. */
export type Rect = [number, number, number, number];

/**
 * The view on a map drawn at its final framing: the point of that drawing at the centre of the map's area, and the
 * zoom. A point p of the final drawing is shown at (p − c)·k + the area's centre.
 */
export interface Cam {
  cx: number;
  cy: number;
  k: number;
}

export const union = (a: Rect, b: Rect): Rect => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

/**
 * The view that shows `box` in `area` with room around it (`pad`, a share of the area), never smaller on the screen
 * than `minSize` of the area's width (so one short flight keeps its region around it) and never wider than the final
 * view (k ≥ 1). Its centre is then moved as little as needed for the screen (`frame`, the final drawing's own
 * rectangle) to show nothing the final view does not: beyond a flat world's edge there is no map.
 */
export function camFor(box: Rect, area: Rect, frame: Rect, pad = 0.14, minSize = 0.24): Cam {
  const aw = area[2] - area[0];
  const ah = area[3] - area[1];
  const bw = Math.max(box[2] - box[0], aw * minSize * (1 - 2 * pad));
  const bh = Math.max(box[3] - box[1], ah * minSize * (1 - 2 * pad));
  const k = Math.max(1, Math.min((aw * (1 - 2 * pad)) / bw, (ah * (1 - 2 * pad)) / bh));
  // The screen shows the final drawing from c − (area centre − frame edge) / k to the other side.
  const ax = (area[0] + area[2]) / 2;
  const ay = (area[1] + area[3]) / 2;
  const cx = clamp((box[0] + box[2]) / 2, frame[0] + (ax - frame[0]) / k, frame[2] - (frame[2] - ax) / k);
  const cy = clamp((box[1] + box[3]) / 2, frame[1] + (ay - frame[1]) / k, frame[3] - (frame[3] - ay) / k);
  return { cx, cy, k };
}

/**
 * Between two views: the zoom changes evenly in scale (each step looks the same), about the one point both show in the
 * same place on the screen, so when one view takes in the other, what was shown stays on the screen all the way.
 * A move with no zoom pans in a straight line.
 */
export function lerpCam(a: Cam, b: Cam, s: number): Cam {
  if (s <= 0) return a;
  if (s >= 1) return b;
  const k = a.k * (b.k / a.k) ** s;
  if (Math.abs(a.k - b.k) < 1e-6 * a.k) return { cx: a.cx + (b.cx - a.cx) * s, cy: a.cy + (b.cy - a.cy) * s, k };
  // The fixed point f: (f − a.c)·a.k = (f − b.c)·b.k.
  const fx = (a.cx * a.k - b.cx * b.k) / (a.k - b.k);
  const fy = (a.cy * a.k - b.cy * b.k) / (a.k - b.k);
  return { cx: fx - ((fx - a.cx) * a.k) / k, cy: fy - ((fy - a.cy) * a.k) / k, k };
}

export interface Move {
  t0: number;
  t1: number;
  from: Cam;
  to: Cam;
}

const camDiff = (a: Cam, b: Cam, area: Rect) => Math.abs(Math.log(b.k / a.k)) + Math.hypot(b.cx - a.cx, b.cy - a.cy) * Math.max(a.k, b.k) / Math.max(1, area[2] - area[0]);

/**
 * The view's moves for a list of views wanted from given times (in order): each move starts at rest and ends at rest,
 * takes longer the further it goes, and starts when the last one has ended; views wanted in the meantime are skipped
 * for the latest, so the view never turns back. Changes too small to see are left out.
 */
export function planMoves(wanted: { t: number; cam: Cam }[], area: Rect): { start: Cam; moves: Move[] } {
  if (!wanted.length) return { start: { cx: (area[0] + area[2]) / 2, cy: (area[1] + area[3]) / 2, k: 1 }, moves: [] };
  const start = wanted[0]!.cam;
  const moves: Move[] = [];
  let at = start;
  let free = wanted[0]!.t;
  for (let i = 1; i < wanted.length; i++) {
    const w = wanted[i]!;
    // The latest view wanted by the time this move can start.
    let j = i;
    const t0 = Math.max(w.t, free);
    while (j + 1 < wanted.length && wanted[j + 1]!.t <= t0) j++;
    const target = wanted[j]!.cam;
    i = j;
    const d = camDiff(at, target, area);
    if (d < 0.02) continue;
    const duration = clamp(0.9 + 0.55 * Math.abs(Math.log2(target.k / at.k)) + 0.35 * Math.min(2, d), 1.0, 2.6);
    moves.push({ t0, t1: t0 + duration, from: at, to: target });
    at = target;
    free = t0 + duration;
  }
  return { start, moves };
}

/** The view at `t` seconds. */
export function camAt(plan: { start: Cam; moves: Move[] }, t: number): Cam {
  let cam = plan.start;
  for (const m of plan.moves) {
    if (t < m.t0) return cam;
    if (t < m.t1) return lerpCam(m.from, m.to, smoother((t - m.t0) / (m.t1 - m.t0)));
    cam = m.to;
  }
  return cam;
}

// ——— The camera of a flight's globe ———

type LonLat = [number, number];
type Vec = [number, number, number];

const RAD = Math.PI / 180;
const EARTH_KM = 6371;
const vec = ([lon, lat]: LonLat): Vec => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
const lonLat = (v: Vec): LonLat => [Math.atan2(v[1], v[0]) / RAD, Math.atan2(v[2], Math.hypot(v[0], v[1])) / RAD];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: Vec): Vec | null => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n > 1e-12 ? [v[0] / n, v[1] / n, v[2] / n] : null;
};
/** East and north at a point, as an orthographic projection centred there lays them out (d3's, unturned). */
const eastNorth = (c: Vec): [Vec, Vec] => {
  const lon = Math.atan2(c[1], c[0]);
  const e: Vec = [-Math.sin(lon), Math.cos(lon), 0];
  return [e, [c[1] * e[2] - c[2] * e[1], c[2] * e[0] - c[0] * e[2], c[0] * e[1] - c[1] * e[0]]];
};

/** An orthographic view of the globe. */
export interface GlobeView {
  /** The point at the middle of the projection. */
  centre: LonLat;
  /** The globe's radius on the screen. */
  r: number;
  /** How far the drawing is moved from the middle of its area, in the globe's radii. */
  off: [number, number];
}

export interface RouteCamera {
  at(t: number): GlobeView;
  /** The view is still before the first time and after the second. */
  moving: [number, number];
}

/**
 * The view of a flight's globe: at first the departure with `near` km either side of it (and up and down in the
 * proportion of the view), then widening along the route as
 * `reach(t)` km of it are to be shown, from `from` to `to` seconds, until it shows the whole route. Everything up to
 * `reach(t)` along the route is in the view (`width` × `height`, with `pad` of room on each side), so an aircraft that
 * has not gone further is too, however far its route strays from the great circle. The view only widens, and it is
 * smoothed over a fraction of a second, so it does not jerk when another point of the route becomes the one at its edge.
 */
export function routeCamera(o: { at: LonLat[]; km: ArrayLike<number>; width: number; height: number; near: number; reach: (t: number) => number; from: number; to: number; pad?: number; minHalfDeg?: number }): RouteCamera {
  const pad = o.pad ?? 0.1;
  const most = o.width / 2 / Math.sin((o.minHalfDeg ?? 1.6) * RAD);
  const n = o.at.length;
  const v = o.at.map(vec);
  const km = o.km;
  const total = km[n - 1] ?? 0;
  // The route's positions summed by the length of the route around each, up to each point: the middle of a stretch.
  const sum: Vec[] = [[0, 0, 0]];
  for (let i = 1; i < n; i++) {
    const w = (km[i]! - km[i - 1]!) / 2;
    const s = sum[i - 1]!;
    sum.push([s[0] + w * (v[i - 1]![0] + v[i]![0]), s[1] + w * (v[i - 1]![1] + v[i]![1]), s[2] + w * (v[i - 1]![2] + v[i]![2])]);
  }
  const dep = v[0] ?? vec([0, 0]);
  const [de, dn] = eastNorth(dep);
  const ring = Array.from({ length: 24 }, (_, k) => [Math.cos((2 * Math.PI * k) / 24), Math.sin((2 * Math.PI * k) / 24)] as const);
  const first = clamp(o.reach(o.from), 0, total);

  /** The view showing the route up to `q` km, and the departure's surroundings: `near` at first, none at the end. */
  const raw = (q: number): { c: Vec; r: number; off: [number, number] } => {
    const x = clamp(q, 0, total);
    const rho = total - first > 1e-9 ? o.near * clamp((total - x) / (total - first), 0, 1) : o.near;
    let i = 0;
    let hi = n - 1;
    while (hi - i > 1) {
      const mid = (i + hi) >> 1;
      if (km[mid]! <= x) i = mid;
      else hi = mid;
    }
    const span = n > 1 ? km[i + 1]! - km[i]! : 0;
    const f = span > 0 ? clamp((x - km[i]!) / span, 0, 1) : 0;
    const a = v[i] ?? dep;
    const b = v[Math.min(n - 1, i + 1)] ?? a;
    const head = unit([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]) ?? a;
    const part = (span * f) / 2;
    const s = sum[i] ?? sum[0]!;
    const c = unit([s[0] + part * (a[0] + head[0]) + 2 * rho * dep[0], s[1] + part * (a[1] + head[1]) + 2 * rho * dep[1], s[2] + part * (a[2] + head[2]) + 2 * rho * dep[2]]) ?? dep;
    const [e, no] = eastNorth(c);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const add = (p: Vec) => {
      if (dot(p, c) <= 0) return;
      const px = dot(p, e);
      const py = -dot(p, no);
      if (px < x0) x0 = px;
      if (px > x1) x1 = px;
      if (py < y0) y0 = py;
      if (py > y1) y1 = py;
    };
    for (let k = 0; k <= i && k < n; k++) add(v[k]!);
    add(head);
    if (rho > 0) {
      for (const [cx, sy] of ring) {
        const east = cx * rho;
        const north = (sy * rho * o.height) / o.width;
        const ang = Math.hypot(east, north) / EARTH_KM;
        const [ca, sa] = [Math.cos(ang), Math.sin(ang) / Math.max(1e-9, Math.hypot(east, north))];
        add([dep[0] * ca + (de[0] * east + dn[0] * north) * sa, dep[1] * ca + (de[1] * east + dn[1] * north) * sa, dep[2] * ca + (de[2] * east + dn[2] * north) * sa]);
      }
    }
    if (!Number.isFinite(x0)) return { c, r: most, off: [0, 0] };
    const r = Math.min((o.width * (1 - 2 * pad)) / Math.max(1e-9, x1 - x0), (o.height * (1 - 2 * pad)) / Math.max(1e-9, y1 - y0), most);
    return { c, r, off: [-(x0 + x1) / 2, -(y0 + y1) / 2] };
  };

  // Views every thirtieth of a second while it moves, the zoom kept from closing in again, then smoothed.
  const sigma = 0.2;
  const reachOut = 3 * sigma;
  const t0 = o.from - reachOut;
  const t1 = Math.max(o.to, o.from) + reachOut;
  const count = Math.max(2, Math.min(1200, Math.ceil((t1 - t0) * 30) + 1));
  const dt = (t1 - t0) / (count - 1);
  const raws = Array.from({ length: count }, (_, k) => raw(o.reach(clamp(t0 + k * dt, o.from, o.to))));
  for (let k = 1; k < count; k++) raws[k]!.r = Math.min(raws[k]!.r, raws[k - 1]!.r);
  const wide = Math.ceil(reachOut / dt);
  const weights = Array.from({ length: 2 * wide + 1 }, (_, j) => Math.exp(-(((j - wide) * dt) ** 2) / (2 * sigma * sigma)));
  const keys = raws.map((_, k) => {
    const c: Vec = [0, 0, 0];
    let logR = 0;
    const off: [number, number] = [0, 0];
    let all = 0;
    for (let j = -wide; j <= wide; j++) {
      const q = raws[clamp(k + j, 0, count - 1)]!;
      const w = weights[j + wide]!;
      c[0] += w * q.c[0];
      c[1] += w * q.c[1];
      c[2] += w * q.c[2];
      logR += w * Math.log(q.r);
      off[0] += w * q.off[0];
      off[1] += w * q.off[1];
      all += w;
    }
    return { c: unit(c) ?? raws[k]!.c, r: Math.exp(logR / all), off: [off[0] / all, off[1] / all] as [number, number] };
  });
  const view = (k: { c: Vec; r: number; off: [number, number] }): GlobeView => ({ centre: lonLat(k.c), r: k.r, off: k.off });
  const firstView = view(keys[0]!);
  const lastView = view(keys[count - 1]!);
  return {
    moving: [t0, t1],
    at(t) {
      if (t <= t0) return firstView;
      if (t >= t1) return lastView;
      const x = (t - t0) / dt;
      const k = Math.min(count - 2, Math.floor(x));
      const s = x - k;
      const a = keys[k]!;
      const b = keys[k + 1]!;
      const c = unit([a.c[0] + (b.c[0] - a.c[0]) * s, a.c[1] + (b.c[1] - a.c[1]) * s, a.c[2] + (b.c[2] - a.c[2]) * s]) ?? a.c;
      return { centre: lonLat(c), r: a.r * (b.r / a.r) ** s, off: [a.off[0] + (b.off[0] - a.off[0]) * s, a.off[1] + (b.off[1] - a.off[1]) * s] };
    },
  };
}
