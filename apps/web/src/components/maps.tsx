// Maps drawn with d3-geo on Natural Earth land (world-atlas, public domain), following
// docs/23-tracks-and-maps.md: Equal Earth across the full width on wide screens, cropped to the period's
// latitudes; on phones a disc centred on the period (a globe when it fits one hemisphere).

import { useEffect, useRef } from "react";
import { geoAzimuthalEqualArea, geoBounds, geoDistance, geoEqualEarth, geoGraticule10, geoInterpolate, geoOrthographic, geoPath, type GeoProjection } from "d3-geo";
import { scaleSqrt } from "d3-scale";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import world from "world-atlas/countries-110m.json";
import { esc, hideTip, showTip } from "./overlay.tsx";

type LonLat = [number, number];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LAND = feature(world as any, (world as any).objects.countries) as unknown as FeatureCollection;
const SVG_NS = "http://www.w3.org/2000/svg";

export interface MapFlight {
  id: string;
  from: LonLat;
  to: LonLat;
  fromCode: string;
  toCode: string;
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  route: string; // undirected route key, for highlighting
  both: boolean; // aircraft also photographed
  tip: string; // tooltip HTML (escaped by the caller)
  track?: LonLat[] | null; // recorded track's points; the great circle is drawn when there is none
  line: LonLat[][]; // drawn solid: the recorded stretches, else the route (the great circle, or around closed airspace)
  gaps?: LonLat[][]; // drawn dashed: what a track does not record, joining it to its airports and across its gaps
}

export interface MapSpot {
  airportId: string;
  name: string;
  code: string;
  at: LonLat;
  aircraft: number;
  both: boolean;
  tip: string;
  label: string; // accessible label
}

function el<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
}

/** Centre of a set of places on the sphere, and whether they all fit on one hemisphere. */
function globeCentre(pts: LonLat[]) {
  const rad = Math.PI / 180;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const [lon, lat] of pts) {
    x += Math.cos(lat * rad) * Math.cos(lon * rad);
    y += Math.cos(lat * rad) * Math.sin(lon * rad);
    z += Math.sin(lat * rad);
  }
  const at: LonLat = [Math.atan2(y, x) / rad, Math.atan2(z, Math.hypot(x, y)) / rad];
  return { at, hemisphere: pts.every((p) => geoDistance(p, at) < 1.5) };
}

/**
 * Central meridian for a flat world map: the map's edge goes where the fewest routes cross it, and among
 * equal choices as far as possible from every airport and track point. With routes all round the globe some
 * route has to be cut; this cuts the fewest.
 */
function centralMeridian(routes: LonLat[][], points: LonLat[]): number {
  if (!routes.length && !points.length) return 10;
  const rel = (lon: number, edge: number) => (((lon - edge) % 360) + 360) % 360;
  let bestEdge = 0;
  let bestScore = Infinity;
  for (let edge = -180; edge < 180; edge += 2) {
    let crossings = 0;
    for (const r of routes) {
      for (let i = 1; i < r.length; i++) {
        const a = r[i - 1]![0];
        const d = ((((r[i]![0] - a + 540) % 360) + 360) % 360) - 180; // shortest signed step in longitude
        const ra = rel(a, edge);
        if (ra + d < 0 || ra + d >= 360) {
          crossings++;
          break; // one cut per route
        }
      }
    }
    let nearest = 180;
    for (const p of points) {
      const x = rel(p[0], edge);
      nearest = Math.min(nearest, x, 360 - x);
    }
    const score = crossings * 1000 - nearest;
    if (score < bestScore) [bestScore, bestEdge] = [score, edge];
  }
  return ((bestEdge + 180 + 540) % 360) - 180;
}

/** Points along a route, what is drawn solid and dashed alike, for framing, centring and pointing. */
export function routeSamplesOf(f: MapFlight): LonLat[] {
  const out: LonLat[] = [];
  for (const part of [...f.line, ...(f.gaps ?? [])]) {
    if (part.length > 60) {
      const step = Math.floor(part.length / 60);
      part.forEach((p, i) => i % step === 0 && out.push(p));
      out.push(part[part.length - 1]!);
      continue;
    }
    for (let i = 1; i < part.length; i++) {
      const at = geoInterpolate(part[i - 1]!, part[i]!);
      for (let k = 0; k <= 10; k++) out.push(at(k / 10) as LonLat);
    }
  }
  return out;
}

function routeSamples(flights: MapFlight[]): LonLat[][] {
  return flights.map(routeSamplesOf);
}

function samplePoints(flights: MapFlight[], spots: MapSpot[]): LonLat[] {
  return [...routeSamples(flights).flat(), ...spots.map((s) => s.at)];
}

/** Bring the given flights forward and fade the rest (or clear the highlight). */
function applyActive(svg: SVGSVGElement, active: Set<string> | null | undefined) {
  svg.classList.toggle("is-focus-route", !!active?.size);
  for (const p of svg.querySelectorAll<SVGPathElement>("path.arc")) {
    const on = !!active?.has(p.dataset.id ?? "");
    p.classList.toggle("is-active", on);
    // Above the other arcs, under the hit areas.
    if (on) p.parentNode?.insertBefore(p, p.parentNode.querySelector(".arc-hit"));
  }
}

function useWidth(ref: React.RefObject<Element | null>, onResize: (w: number) => void, deps: unknown[]) {
  useEffect(() => {
    const node = ref.current?.parentElement;
    if (!node) return;
    let last = -1;
    const run = () => {
      const w = Math.max(320, node.clientWidth);
      if (w !== last) {
        last = w;
        onResize(w);
      }
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(node);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

interface WorldMapProps {
  flights: MapFlight[];
  spots?: MapSpot[];
  mode?: "auto" | "world" | "fit";
  className?: string;
  onArcEnter?: (f: MapFlight) => void;
  onArcLeave?: (f: MapFlight) => void;
  onArcClick?: (f: MapFlight) => void;
  /** Click on an airport or a spotting location: opens the airport page. */
  onAirportClick?: (airportId: string) => void;
  /** Flights to bring forward; the others fade. */
  activeIds?: Set<string> | null;
  label: string;
}

export function WorldMap({ flights, spots = [], mode = "auto", className = "", onArcEnter, onArcLeave, onArcClick, onAirportClick, activeIds, label }: WorldMapProps) {
  const ref = useRef<SVGSVGElement>(null);
  const activeKey = activeIds ? [...activeIds].sort().join(",") : "";
  const activeRef = useRef(activeIds);
  activeRef.current = activeIds;
  const handlers = useRef({ onArcEnter, onArcLeave, onArcClick, onAirportClick });
  handlers.current = { onArcEnter, onArcLeave, onArcClick, onAirportClick };
  const dataKey = flights.map((f) => `${f.id}:${f.track?.length ?? 0}`).join(",") + "|" + spots.map((s) => `${s.code}:${s.aircraft}`).join(",");

  useWidth(
    ref,
    (width) => {
      const svg = ref.current!;
      const m = mode === "auto" ? (width < 720 ? "fit" : "world") : mode;
      const clickable = (node: SVGElement, airportId: string) => {
        if (!handlers.current.onAirportClick) return;
        node.classList.add("is-clickable");
        node.addEventListener("click", () => {
          hideTip();
          handlers.current.onAirportClick?.(airportId);
        });
        node.addEventListener("keydown", (ev) => {
          if ((ev as KeyboardEvent).key === "Enter") handlers.current.onAirportClick?.(airportId);
        });
      };
      const lines = flights.map((f) => ({ type: "MultiLineString" as const, coordinates: f.line }));
      // The whole route (track and gaps) is what the pointer and the map's framing work with.
      const routes = flights.map((f) => ({ type: "MultiLineString" as const, coordinates: [...f.line, ...(f.gaps ?? [])] }));
      const geoms: Geometry[] = [...routes, ...spots.map((s) => ({ type: "Point" as const, coordinates: s.at }))];
      const fc: FeatureCollection = { type: "FeatureCollection", features: geoms.map((g) => ({ type: "Feature", geometry: g, properties: {} }) as Feature) };
      const pts = samplePoints(flights, spots);
      const centre = centralMeridian(routeSamples(flights), [...flights.flatMap((f) => [f.from, f.to]), ...spots.map((s) => s.at)]);
      let proj: GeoProjection = geoEqualEarth().rotate([-centre, 0]);
      let globe = false;
      let vb: [number, number, number, number];
      if (m === "world") {
        proj.fitWidth(width, { type: "Sphere" });
        const [[, south], [, north]] = geoms.length ? geoBounds(fc) : [[0, -40], [0, 70]];
        const top = proj([centre, Math.min(82, north + 12)])![1];
        const bottom = proj([centre, Math.max(-58, south - 12)])![1];
        vb = [0, top, width, bottom - top];
      } else {
        const pad = 28;
        if (width < 600 && geoms.length) {
          const c = globeCentre(pts);
          proj = c.hemisphere
            ? geoOrthographic().rotate([-c.at[0], -c.at[1]]).clipAngle(90)
            : geoAzimuthalEqualArea().rotate([-c.at[0], -c.at[1]]).clipAngle(170);
          globe = true;
        }
        const target = geoms.length ? fc : ({ type: "Sphere" } as const);
        proj.fitExtent([[44, pad], [width - 44, Math.max(240, width * (globe ? 1 : 0.55))]], target as never);
        const [[, y0], [, y1]] = geoPath(proj).bounds(target as never);
        const h = Math.max(220, y1 - y0 + 2 * pad);
        vb = [0, (y0 + y1) / 2 - h / 2, width, h];
      }
      const path = geoPath(proj);
      svg.setAttribute("viewBox", vb.join(" "));
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(vb[3]));
      svg.replaceChildren();
      if (globe) el(svg, "path", { class: "sphere", d: path({ type: "Sphere" }) ?? "" });
      el(svg, "path", { class: "graticule", d: path(geoGraticule10()) ?? "" });
      const landG = el(svg, "g", {});
      for (const f of LAND.features) el(landG, "path", { class: "land", d: path(f) ?? "" });

      const arcs = el(svg, "g", {});
      const arcPaths: SVGPathElement[] = [];
      flights.forEach((f, i) => {
        const d = path(lines[i]!) ?? "";
        arcPaths.push(el(arcs, "path", { class: `arc${f.track ? " arc--track" : ""}${f.both ? " is-both" : ""}`, "data-id": f.id, "data-route": f.route, d }));
        for (const g of f.gaps ?? []) {
          el(arcs, "path", { class: `arc arc--gap${f.both ? " is-both" : ""}`, "data-id": f.id, "data-route": f.route, d: path({ type: "LineString", coordinates: g }) ?? "" });
        }
      });
      flights.forEach((f, i) => {
        const hit = el(arcs, "path", { class: "arc-hit", d: path(routes[i]!) ?? "" });
        hit.addEventListener("pointerenter", (ev) => {
          showTip(f.tip, ev.clientX, ev.clientY);
          handlers.current.onArcEnter?.(f);
        });
        hit.addEventListener("pointermove", (ev) => showTip(f.tip, ev.clientX, ev.clientY));
        hit.addEventListener("pointerleave", () => {
          hideTip();
          handlers.current.onArcLeave?.(f);
        });
        hit.addEventListener("click", () => handlers.current.onArcClick?.(f));
      });

      const spotR = new Map<string, number>();
      if (spots.length) {
        const max = Math.max(...spots.map((s) => s.aircraft), 1);
        const r = scaleSqrt().domain([0, max]).range([4, width < 600 ? 9 : 13]);
        const g = el(svg, "g", {});
        for (const s of [...spots].sort((a, b) => b.aircraft - a.aircraft)) {
          const xy = proj(s.at);
          if (!xy) continue;
          spotR.set(s.code, r(s.aircraft));
          const c = el(g, "circle", { class: `spot${s.both ? " is-both" : ""}`, cx: xy[0], cy: xy[1], r: r(s.aircraft), tabindex: 0, role: "link", "aria-label": `${s.label}. Open the airport page` });
          c.addEventListener("pointerenter", (ev) => showTip(s.tip, ev.clientX, ev.clientY));
          c.addEventListener("pointermove", (ev) => showTip(s.tip, ev.clientX, ev.clientY));
          c.addEventListener("pointerleave", hideTip);
          clickable(c, s.airportId);
        }
      }

      // Airports flown through, labelled greedily: no overlaps, nothing outside the frame.
      const visits = new Map<string, { n: number; at: LonLat; code: string; name: string; id: string }>();
      for (const f of flights) {
        for (const [code, at, id, name] of [[f.fromCode, f.from, f.fromId, f.fromName], [f.toCode, f.to, f.toId, f.toName]] as const) {
          const v = visits.get(code) ?? { n: 0, at, code, name, id };
          v.n++;
          visits.set(code, v);
        }
      }
      const apG = el(svg, "g", {});
      for (const [code, v] of visits) {
        if (spotR.has(code)) continue;
        const xy = proj(v.at);
        if (!xy) continue;
        const dot = el(apG, "circle", { class: "airport", cx: xy[0], cy: xy[1], r: 4 });
        // A larger invisible target, so the small dot is easy to point at and tap.
        const hit = el(apG, "circle", { class: "airport-hit", cx: xy[0], cy: xy[1], r: 11, tabindex: 0, role: "link", "aria-label": `${v.name}: ${v.n} flights. Open the airport page` });
        const tip = `<strong>${esc(v.name)} (${esc(code)})</strong><br><span class="muted">${v.n} flight${v.n === 1 ? "" : "s"} in this period · click for the airport page</span>`;
        hit.addEventListener("pointerenter", (ev) => {
          dot.classList.add("is-hover");
          showTip(tip, ev.clientX, ev.clientY);
        });
        hit.addEventListener("pointermove", (ev) => showTip(tip, ev.clientX, ev.clientY));
        hit.addEventListener("pointerleave", () => {
          dot.classList.remove("is-hover");
          hideTip();
        });
        clickable(hit, v.id);
      }
      const spotIds = new Map(spots.map((s) => [s.code, s.airportId]));
      const marks = [...new Set([...visits.keys(), ...spotR.keys()])]
        .map((code) => {
          const at = visits.get(code)?.at ?? spots.find((s) => s.code === code)!.at;
          return { code, id: visits.get(code)?.id ?? spotIds.get(code) ?? "", xy: proj(at), r: spotR.get(code) ?? 4, weight: (visits.get(code)?.n ?? 0) * 2 + (spotR.get(code) ?? 0) };
        })
        .filter((d): d is { code: string; id: string; xy: [number, number]; r: number; weight: number } => !!d.xy);
      const boxes = marks.map((d) => [d.xy[0] - d.r - 1, d.xy[1] - d.r - 1, d.xy[0] + d.r + 1, d.xy[1] + d.r + 1]);
      const frame = [vb[0] + 2, vb[1] + 2, vb[0] + vb[2] - 2, vb[1] + vb[3] - 2];
      const blocked = (b: number[], self: number) =>
        b[0]! < frame[0]! || b[1]! < frame[1]! || b[2]! > frame[2]! || b[3]! > frame[3]! ||
        boxes.some((o, i) => i !== self && b[0]! < o[2]! && b[2]! > o[0]! && b[1]! < o[3]! && b[3]! > o[1]!);
      marks
        .map((d, i) => ({ ...d, i }))
        .sort((a, b) => b.weight - a.weight)
        .forEach((d) => {
          const off = d.r + 4;
          const w = d.code.length * 7.2 + 2;
          const [x, y] = d.xy;
          const tries: [number, number, string, number[]][] = [
            [x + off, y + 4, "start", [x + off, y - 7, x + off + w, y + 5]],
            [x - off, y + 4, "end", [x - off - w, y - 7, x - off, y + 5]],
            [x, y - off - 3, "middle", [x - w / 2, y - off - 14, x + w / 2, y - off - 2]],
            [x, y + off + 10, "middle", [x - w / 2, y + off, x + w / 2, y + off + 12]],
          ];
          const pick = tries.find((t) => !blocked(t[3], d.i));
          if (!pick) return;
          boxes.push(pick[3]);
          const t = el(apG, "text", { class: "airport-label is-link", x: pick[0], y: pick[1], "text-anchor": pick[2] });
          t.textContent = d.code;
          if (d.id) clickable(t, d.id);
        });
      applyActive(svg, activeRef.current);
    },
    [dataKey, mode],
  );

  // Highlighting only toggles classes, so it never redraws the map; a redraw applies it again.
  useEffect(() => {
    if (ref.current) applyActive(ref.current, activeRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, dataKey]);

  return <svg className={`map ${className}`} ref={ref} role="img" aria-label={label} />;
}

interface FlightMapProps {
  from: LonLat;
  to: LonLat;
  fromCode: string;
  toCode: string;
  /** Drawn solid: the recorded stretches, else the way below. */
  line: LonLat[][];
  /** Drawn dashed: what the track does not record. */
  gaps?: LonLat[][];
  recorded: boolean;
  /** The way with no recording: the great circle, or around airspace the airline could not use. */
  way: LonLat[];
  label: string;
  onAirportClick?: (which: "from" | "to") => void;
}

export function FlightMap({ from, to, fromCode, toCode, line, gaps = [], recorded, way, label, onAirportClick }: FlightMapProps) {
  const ref = useRef<SVGSVGElement>(null);
  const clickRef = useRef(onAirportClick);
  clickRef.current = onAirportClick;
  useWidth(
    ref,
    (width) => {
      const svg = ref.current!;
      const height = width < 600 ? 280 : 430;
      const mid = geoInterpolate(from, to)(0.5);
      const coords = [...line.flat(), ...gaps.flat(), ...way];
      const proj = geoOrthographic()
        .rotate([-mid[0], -mid[1]])
        .clipAngle(90)
        .fitExtent([[56, 40], [width - 56, height - 36]], { type: "MultiPoint", coordinates: [...coords, from, to] });
      const path = geoPath(proj);
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));
      svg.replaceChildren();
      el(svg, "path", { class: "sphere", d: path({ type: "Sphere" }) ?? "" });
      el(svg, "path", { class: "graticule", d: path(geoGraticule10()) ?? "" });
      const landG = el(svg, "g", {});
      for (const f of LAND.features) el(landG, "path", { class: "land", d: path(f) ?? "" });
      const gc = { type: "LineString" as const, coordinates: way };
      if (recorded) {
        el(svg, "path", { class: "gc", d: path(gc) ?? "" });
        const runs = { type: "MultiLineString" as const, coordinates: line };
        el(svg, "path", { class: "track-halo", d: path(runs) ?? "" });
        el(svg, "path", { class: "track", d: path(runs) ?? "" });
        for (const g of gaps) el(svg, "path", { class: "track track--gap", d: path({ type: "LineString", coordinates: g }) ?? "" });
      } else el(svg, "path", { class: "gc gc--primary", d: path(gc) ?? "" });
      for (const [at, code, anchor, which] of [[from, fromCode, "end", "from"], [to, toCode, "start", "to"]] as const) {
        const xy = proj(at);
        if (!xy) continue;
        el(svg, "circle", { class: "airport", cx: xy[0], cy: xy[1], r: 5 });
        const t = el(svg, "text", { class: "airport-label is-link is-clickable", x: xy[0] + (anchor === "end" ? -10 : 10), y: xy[1] + 4, "text-anchor": anchor, style: "font-size:13px" });
        t.textContent = code;
        const hit = el(svg, "circle", { class: "airport-hit is-clickable", cx: xy[0], cy: xy[1], r: 12, tabindex: 0, role: "link", "aria-label": `${code}: open the airport page` });
        for (const node of [t, hit]) {
          node.addEventListener("click", () => clickRef.current?.(which));
          node.addEventListener("keydown", (ev) => {
            if ((ev as KeyboardEvent).key === "Enter") clickRef.current?.(which);
          });
        }
      }
    },
    [from.join(), to.join(), line.map((l) => l.length).join(), gaps.length, way.join()],
  );
  return <svg className="map" ref={ref} role="img" aria-label={label} />;
}
