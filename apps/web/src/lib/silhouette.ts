// An aircraft type seen from above, drawn from its own dimensions (G11, docs/13-reference-data.md, "Silhouettes"): the
// fuselage's length and width, the wing's span, sweep and taper, where the engines sit, the tailplane, propellers or a
// rotor. Every part is a closed outline turning the same way, so one path filled with the non-zero rule draws them as
// one shape. Units are metres, the nose at the top: a 757 comes out long and narrow, an A380 broad, and two types drawn
// at one scale compare as they are.

import type { SilhouetteShape } from "@touchdown/core";

/** What is drawn of a type: its dimensions (from its figures where known) and the shape of its family. */
export interface Planform {
  /** Overall length, wingspan and the fuselage's width, metres. */
  length: number;
  span: number;
  width: number;
  /** The wing's sweep at a quarter of its chord, degrees. */
  sweep: number;
  shape: Shape;
}

export type Shape = SilhouetteShape;

type Pt = [number, number];

const RAD = Math.PI / 180;

/** A closed outline, turned clockwise on the screen (y down), so every part adds to the fill. */
function clockwise(points: Pt[]): Pt[] {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!;
    const [x2, y2] = points[(i + 1) % points.length]!;
    area += x1 * y2 - x2 * y1;
  }
  return area < 0 ? [...points].reverse() : points;
}

const mirror = (points: Pt[]): Pt[] => points.map(([x, y]) => [-x, y] as Pt).reverse();

/** An ellipse as an outline: an engine's nacelle, a propeller's spinner. */
function ellipse(cx: number, cy: number, rx: number, ry: number, steps = 24): Pt[] {
  return Array.from({ length: steps }, (_, i) => [cx + rx * Math.cos((2 * Math.PI * i) / steps), cy + ry * Math.sin((2 * Math.PI * i) / steps)] as Pt);
}

/** A rectangle with rounded ends along y: a nacelle seen from above, a propeller blade. */
function capsule(cx: number, y0: number, y1: number, halfWidth: number): Pt[] {
  const r = Math.min(halfWidth, (y1 - y0) / 2);
  const out: Pt[] = [];
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI + (Math.PI * i) / 8;
    out.push([cx + r * Math.cos(a), y0 + r + r * Math.sin(a)]);
  }
  for (let i = 0; i <= 8; i++) {
    const a = (Math.PI * i) / 8;
    out.push([cx + r * Math.cos(a), y1 - r + r * Math.sin(a)]);
  }
  return out;
}

/** A jet engine's nacelle seen from above: a rounded intake, its sides narrowing a little to the exhaust. */
function nacelle(cx: number, y0: number, y1: number, r: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI + (Math.PI * i) / 10;
    out.push([cx + r * Math.cos(a), y0 + r + r * 0.9 * Math.sin(a)]);
  }
  out.push([cx + r, y0 + r * 1.6], [cx + r * 0.72, y1], [cx - r * 0.72, y1], [cx - r, y0 + r * 1.6]);
  return out;
}

/** The fuselage's half-width at `y` metres from the nose: a rounded nose, a straight body, a tail cone narrowing to a point. */
function fuselageHalf(p: Planform, y: number): number {
  const w = p.width / 2;
  const nose = Math.min(p.length * 0.3, (p.shape.nose ?? 1.6) * p.width);
  const tail = Math.min(p.length * 0.4, (p.shape.tail ?? 3) * p.width);
  if (y <= 0 || y >= p.length) return 0;
  if (y < nose) return w * Math.sqrt(1 - (1 - y / nose) ** 2);
  const boom = p.shape.boom ?? 0;
  if (boom > 0) {
    // A cabin, narrowing over a short way into the boom, which runs at a fifth of its width to the end.
    const start = p.length * (1 - boom);
    const neck = p.width * 1.2;
    if (y > start) return w * 0.2;
    if (y > start - neck) return w * (0.2 + 0.8 * (1 - ((y - (start - neck)) / neck) ** 1.5));
    return w;
  }
  if (y > p.length - tail) {
    const s = (y - (p.length - tail)) / tail;
    return w * (1 - 0.85 * s ** 1.6);
  }
  return w;
}

function fuselage(p: Planform): Pt[] {
  const steps = 80;
  const right: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const y = (p.length * i) / steps;
    right.push([fuselageHalf(p, y), y]);
  }
  // The tail cone ends in a short flat edge, not a needle.
  return [...right, ...mirror(right)];
}

/** One wing (the right one): from its root at the fuselage's side out to the tip, swept and tapered, with its tip device. */
function wing(p: Planform, span: number, sweepDeg: number, rootAt: number, rootChord: number, tipRatio: number, device: Shape["wing"]["device"]): Pt[] {
  const half = span / 2;
  const tipChord = rootChord * tipRatio;
  const root = fuselageHalf(p, rootAt + rootChord / 2);
  const reach = half - root;
  // From the quarter-chord sweep to the leading edge's: the quarter-chord line runs from a quarter of the root's chord to a
  // quarter of the tip's.
  const quarter = Math.tan(sweepDeg * RAD);
  const tipLe = rootAt + rootChord / 4 + quarter * reach - tipChord / 4;
  const le: Pt[] = [
    [0, rootAt],
    [half, tipLe],
  ];
  const te: Pt[] = [[half, tipLe + tipChord]];
  // Airliners' trailing edges run straight out from the root to a kink, then follow the leading edge's line.
  if (p.shape.kind === "jet" && sweepDeg > 15) {
    const kinkAt = root + reach * 0.32;
    const leAtKink = rootAt + (tipLe - rootAt) * ((kinkAt - 0) / half);
    const chordAtKink = rootChord + (tipChord - rootChord) * ((kinkAt - root) / reach) * 0.85;
    te.push([kinkAt, leAtKink + chordAtKink * 0.78]);
    te.push([0, rootAt + rootChord]);
  } else te.push([0, rootAt + rootChord]);
  if (device === "raked") {
    // The outer tenth swept back much more, its chord narrowing to a point that is still a short tip.
    const at = 0.9;
    const leAt = rootAt + (tipLe - rootAt) * at;
    const teAt = leAt + rootChord + (tipChord - rootChord) * ((half * at - root) / reach);
    return clockwise([[0, rootAt], [half * at, leAt], [half, tipLe + tipChord * 0.95], [half, tipLe + tipChord * 1.25], [half * at, teAt], ...te.slice(1)]);
  }
  if (device === "winglet" || device === "sharklet" || device === "blended") {
    // Seen from above, an upturned tip shows as a short, narrow continuation.
    const w = tipChord * (device === "sharklet" ? 0.55 : 0.5);
    const out2: Pt[] = [...le, [half + w * 0.25, tipLe + tipChord * 0.35], [half + w * 0.3, tipLe + tipChord * 0.9], ...te];
    return clockwise(out2);
  }
  return clockwise([...le, ...te]);
}

function tailplane(p: Planform): Pt[] | null {
  const s = p.shape.stab;
  if (s.span <= 0) return null;
  const half = (p.span * s.span) / 2;
  const root = (s.root ?? 0.11) * p.length;
  const tip = root * 0.4;
  let at = p.length * s.at;
  const reachOf = (y: number) => Math.tan(s.sweep * RAD) * (half - fuselageHalf(p, y + root / 2)) + (root - tip) / 4;
  // Its tips end before the tail cone does, as a real tailplane's: a wide, swept one moves forward to do so.
  const over = at + reachOf(at) + tip - p.length * 0.99;
  if (over > 0) at -= over;
  const tipLe = at + reachOf(at);
  return clockwise([
    [0, at],
    [half, tipLe],
    [half, tipLe + tip],
    [0, at + root],
  ]);
}

/** The outlines a type is drawn with: fuselage, wings, tailplane, engines, propellers or rotor. */
export function planformParts(p: Planform): Pt[][] {
  const s = p.shape;
  const parts: Pt[][] = [clockwise(fuselage(p))];
  if (s.kind === "helicopter") {
    // The rotor as its blades from the mast, over the cabin, and a tail rotor's short bar at the end of the boom.
    const mastY = p.length * 0.3;
    const r = p.span / 2;
    const blades = s.blades ?? 2;
    for (let i = 0; i < blades; i++) {
      const a = (2 * Math.PI * i) / blades + Math.PI / 4;
      const along: Pt = [Math.cos(a), Math.sin(a)];
      const across: Pt = [-along[1] * 0.18, along[0] * 0.18];
      parts.push(clockwise([[across[0], mastY + across[1]], [along[0] * r + across[0], mastY + along[1] * r + across[1]], [along[0] * r - across[0], mastY + along[1] * r - across[1]], [-across[0], mastY - across[1]]]));
    }
    parts.push(clockwise(ellipse(0, mastY, p.width * 0.32, p.width * 0.32)));
    // A small stabiliser across the boom near its end.
    const stabHalf = p.span * 0.12;
    const sy = p.length * 0.9;
    parts.push(clockwise([[-stabHalf, sy], [stabHalf, sy], [stabHalf, sy + p.width * 0.35], [-stabHalf, sy + p.width * 0.35]]));
    return parts;
  }
  const wingRootAt = p.length * s.wing.at;
  const rootChord = p.length * s.wing.root;
  const right = wing(p, p.span, p.sweep, wingRootAt, rootChord, s.wing.tip, s.wing.device ?? null);
  parts.push(right, clockwise(mirror(right)));
  const stab = tailplane(p);
  if (stab) parts.push(stab, clockwise(mirror(stab)));

  const half = p.span / 2;
  const size = s.engines?.size ?? 1;
  const leAt = (x: number) => {
    // Where the leading edge is at `x` metres out.
    const root = fuselageHalf(p, wingRootAt + rootChord / 2);
    const tipChord = rootChord * s.wing.tip;
    const tipLe = wingRootAt + rootChord / 4 + Math.tan(p.sweep * RAD) * (half - root) - tipChord / 4;
    return wingRootAt + (tipLe - wingRootAt) * (x / half);
  };
  for (const f of s.engines?.wing ?? []) {
    const x = half * f;
    const y = leAt(x);
    if (s.kind === "prop") {
      // A nacelle running back over the wing, a spinner and the propeller's disc seen edge on.
      const nacelle = p.width * 0.32 * size;
      parts.push(clockwise(capsule(x, y - nacelle * 1.4, y + rootChord * 0.9, nacelle / 2)), clockwise(capsule(-x, y - nacelle * 1.4, y + rootChord * 0.9, nacelle / 2)));
      const d = s.prop ?? p.span * 0.14;
      for (const sx of [x, -x]) parts.push(clockwise([[sx - d / 2, y - nacelle * 1.45], [sx + d / 2, y - nacelle * 1.45], [sx + d / 2, y - nacelle * 1.3], [sx - d / 2, y - nacelle * 1.3]]));
    } else {
      // A jet's nacelle hangs ahead of the leading edge, its rear under the wing.
      const length = p.width * 1.3 * size;
      const radius = p.width * 0.26 * size;
      // Over the wing, it sits above the wing's rear and reaches past the trailing edge.
      const [front, back] = s.engines?.over ? [y + rootChord * s.wing.tip * 0.35, y + rootChord * s.wing.tip * 0.35 + length] : [y - length * 0.7, y + length * 0.3];
      for (const sx of [x, -x]) parts.push(clockwise(nacelle(sx, front, back, radius)));
    }
  }
  if (s.engines?.rear) {
    // Two nacelles beside the tail cone, and a third on the centreline for a trijet.
    // A third engine in the tail sits within the fuselage's width, so it does not show from above.
    const length = p.width * 1.25 * size;
    const radius = p.width * 0.28 * size;
    const y = p.length * (s.stab.at - 0.08);
    const x = fuselageHalf(p, y) + radius * 0.95;
    for (const sx of [x, -x]) parts.push(clockwise(nacelle(sx, y - length / 2, y + length / 2, radius)));
  }
  if (s.kind === "prop" && !s.engines?.wing?.length) {
    // A single engine in the nose: its propeller across the nose.
    const d = s.prop ?? 1.9;
    parts.push(clockwise([[-d / 2, -0.05], [d / 2, -0.05], [d / 2, 0.12], [-d / 2, 0.12]]));
  }
  return parts;
}

/** The parts' extent: [minX, minY, maxX, maxY]. */
export function extentOf(parts: Pt[][]): [number, number, number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const part of parts)
    for (const [x, y] of part) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  return [x0, y0, x1, y1];
}

/** One SVG path of every part, in metres, to fill with the non-zero rule. */
export function planformPath(parts: Pt[][]): string {
  const n = (v: number) => Math.round(v * 100) / 100;
  return parts.map((part) => `M${part.map(([x, y]) => `${n(x)} ${n(y)}`).join("L")}Z`).join("");
}
