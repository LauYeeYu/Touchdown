// The site's preview for chat apps (docs/33-accounts-and-sign-in.md, "Previews"): a link to the site opens the sign-in
// page, whose head names this picture: a globe seen from above the north, a chain of flights around the world on it in
// the flown gold, places photographed in the spotted blue, and the logo under it. The flights are made up, along the
// paths flights take: across the North Atlantic on its tracks, from Europe to the Gulf around Russia's airspace, with
// an airway's small turns. Run after the sign-in pages' build (package.json): it writes the picture beside them and its
// address, with a hash of it, into their page's head, where the server makes it whole.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { geoDistance, geoGraticule10, geoInterpolate, geoOrthographic, geoPath } from "d3-geo";
import type { FeatureCollection, LineString } from "geojson";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import world from "world-atlas/countries-50m.json" with { type: "json" };
import { loadRefTables } from "@touchdown/refdata";
import { C, H, keep, logo, num, picture } from "./picture.ts";

const DIR = join(import.meta.dirname, "../dist/signin-files");
const FILE = "preview.png";

const airports = new Map(loadRefTables().airports.flatMap((a) => (a.iata ? [[a.iata, a] as const] : [])));
const at = (iata: string): [number, number] => {
  const a = airports.get(iata);
  if (!a) throw new Error(`${iata} is not in the reference tables.`);
  return [a.lon, a.lat];
};

/** Flights from one airport to another through the points they pass, longitude and latitude. */
const FLIGHTS: [string, string, [number, number][]][] = [
  // Around the world, eastbound from London.
  ["LHR", "DXB", [[5, 50.4], [13, 47.8], [20, 45.2], [27, 43.2], [35, 41.4], [42, 39.6], [47.4, 35.8], [50.6, 31.6], [53.6, 27.6]]],
  ["DXB", "SIN", [[58.4, 24.6], [63, 23.4], [70, 20.2], [77, 15.6], [84, 11.4], [90, 8.6], [96, 6.2], [100.4, 3.4]]],
  ["SIN", "HKG", [[105.6, 3.2], [108.8, 7.2], [111.4, 12.4], [113, 17.4]]],
  ["HKG", "NRT", [[117.4, 23], [122.4, 25], [128.6, 29.4], [135, 33.4]]],
  ["NRT", "HNL", [[148, 34.6], [160, 32.4], [172, 28.8], [-176, 25.4], [-166, 22.8]]],
  ["HNL", "LAX", [[-150, 23.2], [-138, 27.6], [-124, 32.6]]],
  ["LAX", "JFK", [[-112, 35.4], [-105, 37.2], [-97, 38.6], [-88, 40.2], [-80, 40.8]]],
  ["JFK", "LHR", [[-70, 42.2], [-65, 44.6], [-58, 48.6], [-50, 51.4], [-40, 53], [-30, 53.4], [-15, 52.4], [-6, 51.6]]],
  // Two more, across the North Atlantic and across Asia.
  ["AMS", "ORD", [[-2, 56], [-15, 59.6], [-30, 61], [-45, 59.4], [-58, 54.8], [-70, 49], [-79, 45], [-85, 43]]],
  ["FRA", "ICN", [[14, 50.8], [22, 49.6], [30, 47.8], [38, 46.2], [46, 44.6], [54, 43.6], [62, 43.2], [72, 43], [82, 42.6], [92, 41.8], [102, 40.4], [112, 39], [120, 38], [125, 37.6]]],
];

/** Places photographed, with how many aircraft: the larger the dot, the more. */
const SPOTTED: [string, number][] = [["LHR", 13], ["AMS", 9], ["HKG", 11], ["SIN", 7], ["JFK", 8], ["FRA", 6], ["NRT", 6], ["DXB", 5], ["LAX", 5]];

/** A flight's track: its legs, each wandering a little off its line, as one flown between waypoints, the same every run. */
function track(from: string, to: string, via: [number, number][]): [number, number][] {
  const points = [at(from), ...via, at(to)];
  let seed = [...from, ...to].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const random = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32 - 0.5;
  const out: [number, number][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const leg = geoInterpolate(points[i]!, points[i + 1]!);
    // The first and the last legs, by the airports, keep to their line.
    const wander = i === 0 || i === points.length - 2 ? 0 : 0.35;
    for (let k = 0; k < 6; k++) {
      const [x, y] = leg(k / 6);
      const w = k === 0 ? 0 : wander * random();
      out.push([x + w, y + w * 0.6]);
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

const r = 254;
const centre: [number, number] = [40, 54];
const projection = geoOrthographic().rotate([-centre[0], -centre[1]]).scale(r).translate([600, 14 + r]).clipAngle(90);
const path = geoPath(projection);
const topology = world as unknown as Topology;
const land = feature(topology, topology.objects.countries!) as unknown as FeatureCollection;
/** On the side of the globe that shows, a little in from its edge. */
const seen = (p: [number, number]) => geoDistance(p, centre) < Math.PI / 2 - 0.05;
const dot = (p: [number, number], radius: number, fill: string, stroke: string, width: number) => {
  const [x, y] = projection(p)!;
  return `<circle cx="${num(x)}" cy="${num(y)}" r="${num(radius)}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`;
};

const flights = FLIGHTS.map(([from, to, via]) => path({ type: "LineString", coordinates: track(from, to, via) } as LineString));
const places = [...new Set(FLIGHTS.flatMap(([from, to]) => [from, to]))].map(at).filter(seen);
const body = [
  `<path d="${path({ type: "Sphere" })}" fill="${C.sphere}"/>`,
  `<path d="${path(geoGraticule10())}" fill="none" stroke="${C.grid}" stroke-width="1"/>`,
  `<path d="${path(land)}" fill="${C.land}" stroke="${C.landEdge}" stroke-width="0.8"/>`,
  ...flights.map((d) => `<path d="${d}" fill="none" stroke="${C.flown}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.92"/>`),
  ...SPOTTED.filter(([c]) => seen(at(c))).map(([c, n]) => dot(at(c), 4 + (n / 13) * 9, C.spotted, C.paper, 2)),
  ...places.map((p) => dot(p, 4, C.paper, C.ink, 1.6)),
  logo(32, H - 20),
].join("");

const hash = keep(join(DIR, FILE), picture(body));
// The page's head names the picture by its address on the site; the server adds the site's origin.
const page = join(DIR, "signin.html");
writeFileSync(page, readFileSync(page, "utf8").replace("</head>", `<meta property="og:image" content="/signin-files/${FILE}?v=${hash}"></head>`));
console.log(`The site's preview: ${FILE}?v=${hash}.`);
