// The timing and the camera of a video of the map (docs/23-tracks-and-maps.md, "Export: video"), as plain numbers:
// when each flight is drawn, which date the ticker shows, how the view moves. Nothing here draws. The rules keep the
// motion calm: every move starts and stops at rest, the view only widens during a period, a zoom keeps in view what
// was shown, and words change no faster than they can be read.

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
 * undated: they come last, evenly). The time between two starts grows with the days between them, but slowly (the
 * square root of the days, up to four months), so a quiet month passes quickly and a trip's flights keep their order
 * with room to be seen: each gets at least `floor` seconds, and connecting flights are drawn one after the other.
 * `weight` (0 to 1, by distance) makes a long flight a little slower to draw than a short one.
 */
export function timeline(when: (number | null)[], weight: number[], span: [number, number]): Timeline {
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
    gaps.push(Math.sqrt(Math.min(days, 120)));
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

/** The date (ms) the ticker stands at, at `t` seconds: moving evenly from one event's date to the next's. */
export function dateClock(slots: Slot[], when: (number | null)[]): (t: number) => number | null {
  const dated = slots.map((s, i) => ({ t: s.start, d: when[i] })).filter((x): x is { t: number; d: number } => x.d !== null && x.d !== undefined);
  return (t) => {
    if (!dated.length) return null;
    if (t <= dated[0]!.t) return dated[0]!.d;
    let lo = 0;
    let hi = dated.length - 1;
    if (t >= dated[hi]!.t) return dated[hi]!.d;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (dated[mid]!.t <= t) lo = mid;
      else hi = mid;
    }
    const p = dated[lo]!;
    const q = dated[hi]!;
    return q.t > p.t ? p.d + ((q.d - p.d) * (t - p.t)) / (q.t - p.t) : q.d;
  };
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
