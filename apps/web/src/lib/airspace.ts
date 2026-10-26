// Closed airspace on the maps (docs/23-tracks-and-maps.md, "Closed airspace"): the countries' outlines from the
// same Natural Earth data the maps draw, for core's routing around them.

import { closedShape, closuresFor, routeAround, type ClosedShape, type LonLat } from "@touchdown/core";
import { feature } from "topojson-client";
import type { FeatureCollection } from "geojson";
import world from "world-atlas/countries-110m.json";

let outlines: Map<string, ClosedShape> | null = null;
const sets = new Map<string, ClosedShape[]>();

/** Outlines by Natural Earth's numeric country code, read once. */
function byNumeric(): Map<string, ClosedShape> {
  if (outlines) return outlines;
  outlines = new Map();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fc = feature(world as any, (world as any).objects.countries) as unknown as FeatureCollection;
  for (const f of fc.features) {
    const g = f.geometry;
    const polygons = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    outlines.set(String(f.id), closedShape(polygons.flat() as LonLat[][]));
  }
  return outlines;
}

/** The outlines of what an airline of `country` could not fly over on `day`; the same array for the same closures. */
export function closedTo(country: string | null | undefined, day: string | null | undefined): ClosedShape[] {
  const closures = closuresFor(country, day);
  if (!closures.length) return [];
  const key = closures.map((c) => c.numeric).join(",");
  let shapes = sets.get(key);
  if (!shapes) sets.set(key, (shapes = closures.map((c) => byNumeric().get(c.numeric)).filter((s): s is ClosedShape => !!s)));
  return shapes;
}

/** The way a stretch with no recording is drawn: the great circle, or around what was closed to the airline. */
export function wayFor(a: LonLat, b: LonLat, closed: ClosedShape[]): LonLat[] {
  return closed.length ? routeAround(a, b, closed) : [a, b];
}
