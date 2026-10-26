// Airspace closed to some airlines (docs/23-tracks-and-maps.md, "Closed airspace"). Where a map draws a stretch it
// has no recording of (a flight's great circle, a gap in its recorded track), a flight of an airline that could not
// use an area that day is drawn around it, through points of the corridors those airlines use instead. The countries'
// outlines come from the caller (the web app's Natural Earth map data), so core carries no map data.

import { EARTH_RADIUS_KM, haversineKm } from "./index.ts";

export type LonLat = [number, number];

export interface AirspaceClosure {
  /** The country whose airspace it is: ISO 3166 alpha-2, and the numeric code Natural Earth's outlines carry. */
  country: string;
  numeric: string;
  name: string;
  from: string; // YYYY-MM-DD
  to: string | null;
  /** The countries whose airlines did not use it (alpha-2), or "all" when it was closed to every civil flight. */
  closedTo: "all" | readonly string[];
}

const EU = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];

export const AIRSPACE_CLOSURES: readonly AirspaceClosure[] = [
  // Russia closed its airspace to the airlines of the EU and of the states that joined the sanctions from the end of February 2022.
  { country: "RU", numeric: "643", name: "Russia", from: "2022-02-28", to: null, closedTo: [...EU, "GB", "US", "CA", "NO", "IS", "CH", "AL", "ME", "MK"] },
  // The EU's and the UK's airlines have kept out of Belarus since June 2021.
  { country: "BY", numeric: "112", name: "Belarus", from: "2021-06-05", to: null, closedTo: [...EU, "GB", "NO", "IS", "CH"] },
  // Closed to all civil flights since 24 February 2022.
  { country: "UA", numeric: "804", name: "Ukraine", from: "2022-02-24", to: null, closedTo: "all" },
];

/** The closures that kept an airline of `airlineCountry` out on `day`. */
export function closuresFor(airlineCountry: string | null | undefined, day: string | null | undefined): AirspaceClosure[] {
  if (!day) return [];
  return AIRSPACE_CLOSURES.filter((c) => day >= c.from && (!c.to || day <= c.to) && (c.closedTo === "all" || (!!airlineCountry && c.closedTo.includes(airlineCountry.toUpperCase()))));
}

/** Cells of the grid a shape is rasterised to, in degrees: about 28 km, well under the margin kept from a border. */
const CELL_DEG = 0.25;

/**
 * A country's outline (the rings of its polygons, outer rings and holes alike) rasterised to a grid of cells on the
 * lon/lat plane: a cell is inside when its centre is, by the even-odd rule. Testing a point is then one lookup. A ring
 * that crosses the 180th meridian (Russia's Chukotka) is unwrapped past it, so the grid can reach east of 180°.
 */
export interface ClosedShape {
  west: number;
  south: number;
  cols: number;
  rows: number;
  cells: Uint8Array;
}

/** A ring with no edge jumping across the 180th meridian: each longitude within 180° of the one before, from -180° on. */
function unwrapped(ring: LonLat[]): LonLat[] {
  const out: LonLat[] = [];
  for (const [lon, lat] of ring) {
    const prev = out[out.length - 1];
    let x = lon;
    if (prev) while (x - prev[0] > 180) x -= 360;
    if (prev) while (prev[0] - x > 180) x += 360;
    out.push([x, lat]);
  }
  const min = Math.min(...out.map(([x]) => x));
  return min < -180 ? out.map(([x, y]) => [x + 360, y] as LonLat) : out;
}

export function closedShape(given: LonLat[][], cell = CELL_DEG): ClosedShape {
  const rings = given.map(unwrapped);
  let [w, e, s, n] = [180, -180, 90, -90];
  for (const r of rings)
    for (const [lon, lat] of r) {
      w = Math.min(w, lon);
      e = Math.max(e, lon);
      s = Math.min(s, lat);
      n = Math.max(n, lat);
    }
  const west = Math.floor(w / cell) * cell;
  const south = Math.floor(s / cell) * cell;
  const cols = Math.max(1, Math.ceil((Math.max(180, e) - west) / cell));
  const rows = Math.max(1, Math.ceil((n - south) / cell));
  const cells = new Uint8Array(cols * rows);
  // Each row, filled between the points where the rings cross its centre line (even-odd).
  for (let row = 0; row < rows; row++) {
    const y = south + (row + 0.5) * cell;
    const xs: number[] = [];
    for (const ring of rings)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i]!;
        const [xj, yj] = ring[j]!;
        if (yi > y !== yj > y) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
      }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil((xs[k]! - west) / cell - 0.5));
      const to = Math.min(cols - 1, Math.floor((xs[k + 1]! - west) / cell - 0.5));
      cells.fill(1, row * cols + from, row * cols + to + 1);
    }
  }
  return { west, south, cols, rows, cells };
}

/** Whether a point is inside a shape (its cell is, at its longitude or the same one past 180°). */
export function insideShape([x, y]: LonLat, shape: ClosedShape): boolean {
  const row = Math.floor((y - shape.south) / CELL_DEG);
  if (row < 0 || row >= shape.rows) return false;
  for (const lon of [x, x + 360]) {
    const col = Math.floor((lon - shape.west) / CELL_DEG);
    if (col >= 0 && col < shape.cols && shape.cells[row * shape.cols + col] === 1) return true;
  }
  return false;
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** The point a fraction `f` of the way along the great circle from a to b. */
function along(a: LonLat, b: LonLat, d: number, f: number): LonLat {
  if (d === 0) return a;
  const [λ1, φ1, λ2, φ2] = [rad(a[0]), rad(a[1]), rad(b[0]), rad(b[1])];
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return [deg(Math.atan2(y, x)), deg(Math.atan2(z, Math.hypot(x, y)))];
}

const km = (a: LonLat, b: LonLat) => haversineKm({ lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] });
const STEP_KM = 25;

/** Whether a point is inside a shape or within about `marginKm` of it (tested at four points around it). */
function nearShape(p: LonLat, s: ClosedShape, marginKm: number): boolean {
  if (insideShape(p, s)) return true;
  if (!marginKm) return false;
  const dLat = marginKm / 111.2;
  const dLon = dLat / Math.max(0.2, Math.cos(rad(p[1])));
  return insideShape([p[0] + dLon, p[1]], s) || insideShape([p[0] - dLon, p[1]], s) || insideShape([p[0], p[1] + dLat], s) || insideShape([p[0], p[1] - dLat], s);
}

/**
 * Whether the great circle from a to b passes over any of the shapes (tested every 25 km), or, with `marginKm`, comes
 * within about that distance of one away from its ends (so that a leg may start at a point near a border).
 */
export function crossesShapes(a: LonLat, b: LonLat, shapes: ClosedShape[], marginKm = 0): boolean {
  if (!shapes.length) return false;
  const dist = km(a, b);
  const d = dist / EARTH_RADIUS_KM;
  const n = Math.max(1, Math.ceil(dist / STEP_KM));
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const p = along(a, b, d, f);
    const margin = Math.min(f, 1 - f) * dist > 2 * marginKm ? marginKm : 0;
    if (shapes.some((s) => nearShape(p, s, margin))) return true;
  }
  return false;
}

/** How far a drawn way round keeps from a closed border: the maps' outlines are coarse. */
const MARGIN_KM = 40;

/**
 * Points on the corridors airlines kept to when Russia, Belarus and Ukraine were closed to them: south of Russia over
 * the Black Sea, the Caucasus, the Caspian, Central Asia and Mongolia; over the Baltic and west of Belarus and Ukraine;
 * and over the Arctic and the Bering Sea between Europe and the Far East. Each lies well inside open airspace.
 */
export const CORRIDOR_POINTS: readonly LonLat[] = [
  // The Baltic, west of Kaliningrad, for the Nordic countries and the Baltic states.
  [18.1, 59.3], [18.3, 57.6], [17.6, 55.0], [24.1, 56.95],
  // Central Europe, west and south of Belarus and Ukraine.
  [16.4, 48.2], [19.0, 47.5], [21.0, 52.2], [22.5, 50.0], [24.5, 46.5], [26.1, 44.4], [28.6, 44.2],
  // The Black Sea, Turkey and the Caucasus.
  [32.0, 42.8], [37.0, 42.0], [32.9, 39.9], [41.6, 41.6], [44.8, 41.7], [49.9, 40.4], [51.4, 35.7],
  // Over the Caspian and Central Asia.
  [53.0, 40.0], [51.2, 43.6], [59.6, 42.5], [66.9, 39.6], [68.3, 43.3], [71.4, 42.9], [76.9, 43.2],
  [61.0, 46.5], [67.7, 47.5], [75.0, 46.8], [84.9, 47.5],
  // Western and northern China, and Mongolia.
  [80.4, 44.2], [87.6, 43.8], [93.5, 42.8], [98.5, 39.7], [103.8, 36.1], [111.7, 40.8],
  [91.6, 48.0], [100.0, 46.5], [106.9, 47.9],
  // The Arctic and the Bering Sea, for Europe to Japan and Korea the northern way.
  [18.9, 69.7], [15.6, 78.2], [0, 88], [-156.8, 71.3], [-165.0, 64.5], [-170.0, 58.0], [-176.6, 51.9], [160.0, 45.0], [150.0, 40.0],
];

const edgeMemo = new WeakMap<ClosedShape[], Map<string, boolean>>();
const routeMemo = new WeakMap<ClosedShape[], Map<string, LonLat[]>>();

/**
 * The way from a to b clear of the shapes: [a, b] when the great circle is clear (or either end is inside one, when no
 * way round can be drawn), else the shortest path through the corridor points whose every leg is clear, as
 * [a, …points, b]. A leg is drawn as a great circle.
 */
export function routeAround(a: LonLat, b: LonLat, shapes: ClosedShape[], points: readonly LonLat[] = CORRIDOR_POINTS): LonLat[] {
  if (!shapes.length) return [a, b];
  // Maps are drawn again and again: a way is worked out once per set of shapes.
  let routes = routeMemo.get(shapes);
  if (!routes) routeMemo.set(shapes, (routes = new Map()));
  const key = `${a}|${b}|${points.length}`;
  const known = routes.get(key);
  if (known) return known;
  const way = findWay(a, b, shapes, points);
  routes.set(key, way);
  return way;
}

function findWay(a: LonLat, b: LonLat, shapes: ClosedShape[], points: readonly LonLat[]): LonLat[] {
  if (!crossesShapes(a, b, shapes)) return [a, b];
  if (shapes.some((s) => insideShape(a, s) || insideShape(b, s))) return [a, b];
  // Kept clear of the borders by a margin; where that leaves no way (an airport close to a border), without it.
  return shortestWay(a, b, shapes, points, MARGIN_KM) ?? shortestWay(a, b, shapes, points, 0) ?? [a, b];
}

/** The shortest way from a to b through the corridor points with every leg clear of the shapes by `margin`, or null. */
function shortestWay(a: LonLat, b: LonLat, shapes: ClosedShape[], points: readonly LonLat[], margin: number): LonLat[] | null {
  // The corridor points' legs between themselves do not depend on a and b: remembered per set of shapes.
  let memo = edgeMemo.get(shapes);
  if (!memo) edgeMemo.set(shapes, (memo = new Map()));
  const nodes: LonLat[] = [a, b, ...points.filter((p) => !shapes.some((s) => nearShape(p, s, margin)))];
  const clear = (i: number, j: number) => {
    if (i > 1 && j > 1) {
      const key = `${margin}|${i < j ? `${nodes[i]}|${nodes[j]}` : `${nodes[j]}|${nodes[i]}`}`;
      let v = memo!.get(key);
      if (v === undefined) memo!.set(key, (v = !crossesShapes(nodes[i]!, nodes[j]!, shapes, margin)));
      return v;
    }
    return !crossesShapes(nodes[i]!, nodes[j]!, shapes, margin);
  };
  // Dijkstra from a (0) to b (1) over legs that are clear, tried as they are reached.
  const dist = nodes.map(() => Infinity);
  const prev = nodes.map(() => -1);
  const done = nodes.map(() => false);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i]! < Infinity && (u < 0 || dist[i]! < dist[u]!)) u = i;
    if (u < 0 || u === 1) break;
    done[u] = true;
    for (let v = 0; v < nodes.length; v++) {
      if (done[v] || v === u) continue;
      const alt = dist[u]! + km(nodes[u]!, nodes[v]!);
      if (alt < dist[v]! && clear(u, v)) [dist[v], prev[v]] = [alt, u];
    }
  }
  if (dist[1] === Infinity) return null;
  const path: LonLat[] = [];
  for (let v = 1; v >= 0; v = prev[v]!) path.unshift(nodes[v]!);
  return path;
}
