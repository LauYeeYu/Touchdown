// Interactive globe: drag to turn, scroll or pinch to zoom about the pointer (lib/globeZoom.ts), point at a route or a
// spotting location for details, click a route to open the flight. Arrow keys turn it and + / − zoom, for keyboard use.
// Drawn on a canvas with d3-geo (orthographic), from the same marks as the flat maps. Inside a page that
// scrolls (`contained`), scrolling and vertical swipes move the page; a pinch or Ctrl-scroll zooms.

import { forwardRef, useContext, useEffect, useImperativeHandle, useRef } from "react";
import { geoDistance, geoGraticule10, geoInterpolate, geoOrthographic, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { FeatureCollection } from "geojson";
import world from "world-atlas/countries-110m.json";
import { t } from "@touchdown/i18n";
import { airportTip, ARRIVE_MS, routeSamplesOf, screenAngle, type MapFlight, type MapSpot } from "./maps.tsx";
import { AIRLINER_MARKER, gapTip, MARKER_DISC, nearest, sampleTip, trackGaps, type TrackGap, type TrackMarker, type TrackSample } from "../lib/trackStatus.ts";
import { esc as escHtml, hideTip, showTip, whenTouchedOutside } from "./overlay.tsx";
import { TrackLoading } from "../lib/trackLoading.tsx";
import { reducedMotion } from "../lib/reducedMotion.ts";
import { turnFor } from "../lib/globeZoom.ts";

/** While tracks load, a great circle waiting for its flight's track is drawn this much fainter, as on the flat maps. */
const PENDING_ALPHA = 0.45;

type LonLat = [number, number];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const LAND = feature(world as any, (world as any).objects.countries) as unknown as FeatureCollection;
const RAD = Math.PI / 180;

export interface GlobeHandle {
  zoomBy: (factor: number) => void;
  reset: () => void;
}

interface Props {
  flights: MapFlight[];
  spots: MapSpot[];
  onFlightClick?: (f: MapFlight) => void;
  onAirportClick?: (airportId: string) => void;
  label: string;
  contained?: boolean;
  /** Great circles drawn dashed under the routes for reference, as on a flight's flat map; not clickable. */
  greatCircles?: LonLat[][];
  /** On a flight's page, its recorded positions: pointing at one shows the aircraft's state there, at a gap what is missing. */
  samples?: TrackSample[];
  /** Takeoff in Unix seconds, for the time since takeoff. */
  takeoff?: number | null;
  /** The aircraft drawn at a recorded position: its type from above, else the usual airliner. */
  marker?: TrackMarker;
}

type Hover =
  | { kind: "flight"; f: MapFlight }
  | { kind: "spot"; s: MapSpot }
  | { kind: "airport"; a: AirportMark }
  | { kind: "sample"; i: number }
  | { kind: "gap"; g: TrackGap }
  | null;

interface AirportMark {
  id: string;
  code: string;
  name: string;
  at: LonLat;
  flights: number;
}

/** Airports of the marks: every route end, and every spotting location. */
function airportMarks(flights: MapFlight[], spots: MapSpot[]): AirportMark[] {
  const m = new Map<string, AirportMark>();
  for (const f of flights) {
    for (const [id, code, name, at] of [[f.fromId, f.fromCode, f.fromName, f.from], [f.toId, f.toCode, f.toName, f.to]] as const) {
      const a = m.get(id) ?? { id, code, name, at, flights: 0 };
      a.flights++;
      m.set(id, a);
    }
  }
  for (const s of spots) if (!m.has(s.airportId)) m.set(s.airportId, { id: s.airportId, code: s.code, name: s.name, at: s.at, flights: 0 });
  return [...m.values()];
}

interface Colours {
  sphere: string;
  land: string;
  landEdge: string;
  grid: string;
  rule: string;
  greatCircle: string;
  flown: string;
  spotted: string;
  ink: string;
  ink2: string;
  ink3: string;
  paper: string;
}

function readColours(): Colours {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return { sphere: v("--globe-sphere") || v("--sphere"), land: v("--land"), landEdge: v("--land-edge"), grid: v("--grid"), rule: v("--rule-strong"), greatCircle: v("--great-circle"), flown: v("--flown"), spotted: v("--spotted"), ink: v("--ink"), ink2: v("--ink-2"), ink3: v("--ink-3"), paper: v("--paper") };
}

/** Points along a route, for hit testing and framing. */
function routePoints(f: MapFlight): LonLat[] {
  return routeSamplesOf(f);
}

function centreOf(points: LonLat[]): LonLat {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const [lon, lat] of points) {
    x += Math.cos(lat * RAD) * Math.cos(lon * RAD);
    y += Math.cos(lat * RAD) * Math.sin(lon * RAD);
    z += Math.sin(lat * RAD);
  }
  return [Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD];
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** How much wider a finger's target is than a mouse's, in pixels. */
const FINGER = 10;

/** A scale kept within the globe's zoom: from 0.3 of the stage's shorter side to 40 times the scale that fits it. */
function within(st: { fitScale: number; width: number; height: number }, scale: number): number {
  return Math.min(st.fitScale * 40, Math.max(Math.min(st.width, st.height) * 0.3, scale));
}

interface View {
  rot: [number, number];
  scale: number;
  fitScale: number;
  width: number;
  height: number;
  dirty: boolean;
}

/** The place on the globe at (x, y) in the stage, or null off its edge. */
function placeAt(st: View, x: number, y: number): LonLat | null {
  const q = geoOrthographic().rotate([st.rot[0], st.rot[1], 0]).scale(st.scale).translate([st.width / 2, st.height / 2]).invert!([x, y]);
  return q && Number.isFinite(q[0]) && Number.isFinite(q[1]) ? (q as LonLat) : null;
}

/** Sets the scale and turns the globe so that `at` stays at (x, y), as far as a turn without roll can. */
function scaleAbout(st: View, scale: number, x: number, y: number, at: LonLat | null) {
  st.scale = within(st, scale);
  if (at) st.rot = turnFor(at, (x - st.width / 2) / st.scale, (st.height / 2 - y) / st.scale, st.rot) ?? st.rot;
  st.dirty = true;
}

export const Globe = forwardRef<GlobeHandle, Props>(function Globe({ flights, spots, onFlightClick, onAirportClick, label, contained = false, greatCircles = [], samples = [], takeoff = null, marker = AIRLINER_MARKER }, handle) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef({
    rot: [0, 0] as [number, number],
    scale: 300,
    fitScale: 300,
    fitRot: [0, 0] as [number, number],
    width: 0,
    height: 0,
    hover: null as Hover,
    dirty: true,
    colours: null as Colours | null,
    velocity: [0, 0] as [number, number],
    inertia: 0,
  });
  // The track's gaps are worked out again only when its positions change.
  const gapsFor = useRef<{ samples: TrackSample[]; gaps: TrackGap[] }>({ samples: [], gaps: [] });
  const one = flights.length === 1 ? flights[0]! : null;
  if (gapsFor.current.samples !== samples) gapsFor.current = { samples, gaps: one && samples.length > 1 ? trackGaps(samples, one.from, one.to, one.fromCode, one.toCode) : [] };
  const loading = useContext(TrackLoading);
  const data = useRef({ flights, spots, onFlightClick, onAirportClick, contained, greatCircles, samples, takeoff, marker, gaps: gapsFor.current.gaps, loading });
  data.current = { flights, spots, onFlightClick, onAirportClick, contained, greatCircles, samples, takeoff, marker, gaps: gapsFor.current.gaps, loading };

  const fit = () => {
    const st = state.current;
    const pts = [...flights.flatMap(routePoints), ...spots.map((s) => s.at)];
    const min = Math.min(st.width, st.height);
    if (!pts.length || !min) {
      st.fitRot = [0, -20];
      st.fitScale = min / 2.2 || 300;
    } else {
      const c = centreOf(pts);
      const maxD = Math.max(...pts.map((p) => geoDistance(p, c)));
      const whole = (min / 2) * 0.9;
      st.fitRot = [-c[0], -c[1]];
      // Zoom in on routes close together, but only until the globe is as wide as the stage: its edge stays in view
      // at the sides, so one short flight still sits on a round globe.
      const edge = Math.max(whole, Math.max(st.width, st.height) * 0.46);
      st.fitScale = maxD >= Math.PI / 2 - 0.05 ? whole : Math.min(edge, Math.max(whole, ((min / 2) * 0.82) / Math.sin(Math.max(maxD, 0.05))));
    }
    st.rot = [...st.fitRot];
    st.scale = st.fitScale;
    st.dirty = true;
  };

  useImperativeHandle(handle, () => ({
    zoomBy: (factor) => {
      const st = state.current;
      st.scale = within(st, st.scale * factor);
      st.dirty = true;
    },
    reset: () => fit(),
  }));

  // Size, colours, and the drawing loop.
  useEffect(() => {
    const el = wrap.current!;
    const cv = canvas.current!;
    const ctx = cv.getContext("2d")!;
    const st = state.current;
    let raf = 0;
    st.colours = readColours();

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      st.width = el.clientWidth;
      st.height = el.clientHeight;
      cv.width = Math.round(st.width * dpr);
      cv.height = Math.round(st.height * dpr);
      cv.style.width = `${st.width}px`;
      cv.style.height = `${st.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      st.dirty = true;
    };
    resize();
    fit();
    const ro = new ResizeObserver(() => {
      const before = Math.min(st.width, st.height);
      resize();
      const after = Math.min(st.width, st.height);
      if (before) {
        st.scale *= after / before;
        st.fitScale *= after / before;
      }
    });
    ro.observe(el);
    const recolour = () => {
      st.colours = readColours();
      st.dirty = true;
    };
    const mo = new MutationObserver(recolour);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", recolour);

    const draw = () => {
      const c = st.colours!;
      const { flights: fl, spots: sp, greatCircles: gc } = data.current;
      const proj = geoOrthographic()
        .clipAngle(90)
        .precision(0.4)
        .rotate([st.rot[0], st.rot[1], 0])
        .scale(st.scale)
        .translate([st.width / 2, st.height / 2]);
      const path = geoPath(proj, ctx);
      const centre: LonLat = [-st.rot[0], -st.rot[1]];
      const zoom = st.scale / Math.max(1, st.fitScale);
      ctx.clearRect(0, 0, st.width, st.height);

      ctx.beginPath();
      path({ type: "Sphere" });
      ctx.fillStyle = c.sphere;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = c.rule;
      ctx.stroke();

      ctx.beginPath();
      path(geoGraticule10());
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = c.grid;
      ctx.stroke();

      ctx.beginPath();
      for (const f of LAND.features) path(f);
      ctx.fillStyle = c.land;
      ctx.fill();
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = c.landEdge;
      ctx.stroke();

      // The great circle beside a flight's recorded track: clearer than the grid, fainter than the track's gaps, as on
      // its flat map.
      if (gc.length) {
        ctx.strokeStyle = c.greatCircle;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        for (const line of gc) path({ type: "LineString", coordinates: line });
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const hoverId = st.hover?.kind === "flight" ? st.hover.f.id : null;
      const lineWidth = Math.min(3, 1.4 + Math.log2(Math.max(1, zoom)) * 0.4);
      const smp = data.current.samples;
      const single = smp.length > 1;
      const shown = (p: LonLat) => (geoDistance(p, centre) < Math.PI / 2 - 0.01 ? (proj(p) as [number, number] | null) : null);
      const drawRoute = (f: MapFlight, width: number, alpha: number) => {
        // Arriving: the great circle it had fades out as the track fades in.
        const a = arriving.current.get(f.id);
        if (f.pending && data.current.loading) alpha *= PENDING_ALPHA;
        if (a) {
          const t = Math.min(1, (performance.now() - a.at) / ARRIVE_MS);
          const k = 1 - Math.pow(1 - t, 3);
          // The great circle it had was waiting, so it fades from faint.
          ctx.globalAlpha = alpha * PENDING_ALPHA * (1 - k);
          ctx.strokeStyle = c.flown;
          ctx.lineWidth = width;
          ctx.setLineDash([]);
          ctx.beginPath();
          path({ type: "MultiLineString", coordinates: a.was });
          ctx.stroke();
          alpha *= k;
        }
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = c.flown;
        ctx.lineWidth = width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.setLineDash([]);
        ctx.beginPath();
        path({ type: "MultiLineString", coordinates: f.line });
        ctx.stroke();
        // What the track does not record: grey dots, since gold means the aircraft was there.
        if (f.gaps?.length) {
          ctx.strokeStyle = c.ink3;
          ctx.lineWidth = single ? 2 : width;
          ctx.setLineDash(single ? [0.1, 5] : [0.1, 4]);
          ctx.beginPath();
          for (const g of f.gaps) path({ type: "LineString", coordinates: g });
          ctx.stroke();
          ctx.setLineDash([]);
        }
        // A lone position between two gaps, which no line passes through, as a dot, as on the flat maps.
        if (f.lone?.length) {
          ctx.fillStyle = c.flown;
          ctx.strokeStyle = c.paper;
          ctx.lineWidth = single ? 1.5 : 1;
          for (const at of f.lone) {
            const xy = shown(at);
            if (!xy) continue;
            ctx.beginPath();
            ctx.arc(xy[0], xy[1], single ? 3.4 : 2.4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
      };
      for (const f of fl) if (f.id !== hoverId) drawRoute(f, lineWidth, hoverId ? 0.22 : 0.85);
      const hovered = hoverId ? fl.find((f) => f.id === hoverId) : undefined;
      if (hovered) drawRoute(hovered, lineWidth + 1.6, 1);
      // A gap under the pointer, over its own dots.
      if (st.hover?.kind === "gap") {
        ctx.strokeStyle = c.ink;
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.setLineDash([0.1, 5]);
        ctx.beginPath();
        path({ type: "LineString", coordinates: [st.hover.g.from, st.hover.g.to] });
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Pointing at the track: at a recorded position, the aircraft from above, turned the way it was going, on a
      // paper disc.
      if (st.hover?.kind === "sample") {
        const p = smp[st.hover.i];
        const xy = p && geoDistance(p.at, centre) < Math.PI / 2 - 0.01 ? proj(p.at) : null;
        if (xy) {
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = c.paper;
          ctx.beginPath();
          ctx.arc(xy[0], xy[1], MARKER_DISC, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.save();
          ctx.translate(xy[0], xy[1]);
          ctx.rotate((screenAngle(smp, st.hover.i, (q) => proj(q) as [number, number] | null) * Math.PI) / 180);
          const m = data.current.marker;
          ctx.scale(m.scale, m.scale);
          ctx.translate(-m.centre[0], -m.centre[1]);
          const plane = new Path2D(m.path);
          ctx.lineWidth = 1.4 / m.scale;
          ctx.strokeStyle = c.paper;
          ctx.stroke(plane);
          ctx.fillStyle = c.ink;
          ctx.fill(plane);
          ctx.restore();
        }
      }

      // Spotting locations, sized by aircraft seen; far side hidden.
      const maxAircraft = Math.max(1, ...sp.map((s) => s.aircraft));
      for (const s of [...sp].sort((a, b) => b.aircraft - a.aircraft)) {
        if (geoDistance(s.at, centre) > Math.PI / 2 - 0.02) continue;
        const xy = proj(s.at);
        if (!xy) continue;
        const r = 4 + 9 * Math.sqrt(s.aircraft / maxAircraft);
        ctx.beginPath();
        ctx.arc(xy[0], xy[1], r, 0, Math.PI * 2);
        ctx.fillStyle = c.spotted;
        ctx.globalAlpha = hoverId ? 0.35 : 1;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        ctx.strokeStyle = c.paper;
        ctx.stroke();
      }

      // Airports flown through, with labels placed greedily without overlaps.
      const airports = new Map<string, { at: LonLat; n: number }>();
      for (const f of fl) {
        for (const [code, at] of [[f.fromCode, f.from], [f.toCode, f.to]] as const) {
          const a = airports.get(code) ?? { at, n: 0 };
          a.n++;
          airports.set(code, a);
        }
      }
      for (const s of sp) if (!airports.has(s.code)) airports.set(s.code, { at: s.at, n: 0 });
      const boxes: number[][] = [];
      const labels: { code: string; x: number; y: number; n: number }[] = [];
      for (const [code, a] of airports) {
        if (geoDistance(a.at, centre) > Math.PI / 2 - 0.02) continue;
        const xy = proj(a.at);
        if (!xy) continue;
        const hoverAirport = st.hover?.kind === "airport" && st.hover.a.code === code;
        if (a.n) {
          ctx.beginPath();
          ctx.arc(xy[0], xy[1], hoverAirport ? 5.5 : 3.5, 0, Math.PI * 2);
          ctx.fillStyle = c.ink;
          ctx.fill();
          ctx.lineWidth = 1.6;
          ctx.strokeStyle = c.paper;
          ctx.stroke();
        }
        labels.push({ code, x: xy[0], y: xy[1], n: a.n });
        boxes.push([xy[0] - 5, xy[1] - 5, xy[0] + 5, xy[1] + 5]);
      }
      ctx.font = "600 11px 'Source Sans 3 Variable', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
      ctx.textBaseline = "middle";
      for (const l of labels.sort((a, b) => b.n - a.n)) {
        const w = ctx.measureText(l.code).width;
        const tries: [number, number, CanvasTextAlign][] = [
          [l.x + 8, l.y, "left"],
          [l.x - 8, l.y, "right"],
          [l.x, l.y - 13, "center"],
          [l.x, l.y + 13, "center"],
        ];
        for (const [x, y, align] of tries) {
          const x0 = align === "left" ? x : align === "right" ? x - w : x - w / 2;
          const box = [x0 - 2, y - 7, x0 + w + 2, y + 7];
          if (box[0]! < 2 || box[2]! > st.width - 2 || box[1]! < 2 || box[3]! > st.height - 2) continue;
          if (boxes.some((b) => box[0]! < b[2]! && box[2]! > b[0]! && box[1]! < b[3]! && box[3]! > b[1]!)) continue;
          boxes.push(box);
          ctx.textAlign = align;
          ctx.lineWidth = 3;
          ctx.strokeStyle = c.paper;
          ctx.strokeText(l.code, x, y);
          ctx.fillStyle = c.ink2;
          ctx.fillText(l.code, x, y);
          break;
        }
      }
    };

    const loop = () => {
      // Draw every frame while a track is arriving, until its fade is over.
      if (arriving.current.size) {
        const now = performance.now();
        for (const [id, a] of arriving.current) if (now - a.at >= ARRIVE_MS) arriving.current.delete(id);
        st.dirty = true;
      }
      if (st.inertia > 0) {
        st.rot = [st.rot[0] + st.velocity[0], Math.max(-89, Math.min(89, st.rot[1] + st.velocity[1]))];
        st.velocity = [st.velocity[0] * 0.92, st.velocity[1] * 0.92];
        st.inertia = Math.hypot(...st.velocity) > 0.02 ? 1 : 0;
        st.dirty = true;
      }
      if (st.dirty) {
        st.dirty = false;
        draw();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      mq.removeEventListener("change", recolour);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A track that arrives while the globe shows fades in over the great circle it replaces, as on the flat maps
  // (maps.tsx, ARRIVE_MS). Tracks arriving is new data too: the globe draws again.
  const seen = useRef(new Map<string, { track: boolean; line: LonLat[][] }>());
  const arriving = useRef(new Map<string, { at: number; was: LonLat[][] }>());
  useEffect(() => {
    const now = performance.now();
    const still = reducedMotion();
    for (const f of flights) {
      const before = seen.current.get(f.id);
      if (before && !before.track && f.track && !still) arriving.current.set(f.id, { at: now, was: before.line });
      seen.current.set(f.id, { track: !!f.track, line: f.line });
    }
    state.current.dirty = true;
  }, [flights]);

  // Tracks starting or stopping to load: the waiting great circles change shade.
  useEffect(() => {
    state.current.dirty = true;
  }, [loading]);

  // New data: redraw; refit when the set of marks changes.
  const key = flights.map((f) => f.id).join(",") + "|" + spots.map((s) => s.code).join(",");
  useEffect(() => {
    if (state.current.width) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Pointer interaction.
  useEffect(() => {
    const cv = canvas.current!;
    const st = state.current;
    const pointers = new Map<number, { x: number; y: number }>();
    let drag: { x: number; y: number; rot: [number, number]; moved: number; t: number; coasting: boolean } | null = null;
    // A touch screen's pinch: the fingers' distance, the scale and the place between them as it began.
    let pinch: { dist: number; scale: number; at: LonLat | null } | null = null;
    // Safari's trackpad pinch under way: the scale it started from, and where the pointer was.
    let gesture: { scale: number; x: number; y: number; at: LonLat | null } | null = null;
    // A finger following the track, by its pointer.
    let following: number | null = null;
    let last = { x: 0, y: 0, t: 0 };
    // The last moments of a drag, for its speed when it ends: one move alone is too uneven to go by.
    let trail: { x: number; y: number; t: number }[] = [];
    let still: ReturnType<typeof setTimeout> | undefined;

    const local = (e: { clientX: number; clientY: number }) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const view = () => ({
      proj: geoOrthographic().clipAngle(90).rotate([st.rot[0], st.rot[1], 0]).scale(st.scale).translate([st.width / 2, st.height / 2]),
      centre: [-st.rot[0], -st.rot[1]] as LonLat,
    });

    /** On a flight's track: the recorded position within `radius` pixels of (x, y), else a gap within 7/12 of that. */
    const trackAt = (x: number, y: number, radius: number) => {
      const { proj, centre } = view();
      const { samples: smp, gaps } = data.current;
      if (smp.length < 2) return null;
      const shown = (p: LonLat) => (geoDistance(p, centre) < Math.PI / 2 - 0.01 ? (proj(p) as [number, number] | null) : null);
      const i = nearest(smp.map((s) => shown(s.at)), x, y, radius);
      if (i >= 0) return { kind: "sample" as const, i };
      for (const g of gaps) {
        const f = geoInterpolate(g.from, g.to);
        let prev: [number, number] | null = null;
        for (let k = 0; k <= 40; k++) {
          const q = shown(f(k / 40) as LonLat);
          if (q && prev && segmentDistance(x, y, prev[0], prev[1], q[0], q[1]) < (radius * 7) / 12) return { kind: "gap" as const, g };
          prev = q;
        }
      }
      return null;
    };

    /** What is under (x, y): a spotting place, an airport, the track, a route. `slack` widens each for a finger. */
    const hitTest = (x: number, y: number, slack = 0) => {
      const { proj, centre } = view();
      const { flights: fl, spots: sp } = data.current;
      const maxAircraft = Math.max(1, ...sp.map((s) => s.aircraft));
      for (const s of sp) {
        if (geoDistance(s.at, centre) > Math.PI / 2) continue;
        const xy = proj(s.at);
        if (xy && Math.hypot(xy[0] - x, xy[1] - y) < 4 + 9 * Math.sqrt(s.aircraft / maxAircraft) + 3 + slack) return { kind: "spot" as const, s };
      }
      for (const a of airportMarks(fl, sp)) {
        if (!a.flights || geoDistance(a.at, centre) > Math.PI / 2) continue;
        const xy = proj(a.at);
        if (xy && Math.hypot(xy[0] - x, xy[1] - y) < 9 + slack) return { kind: "airport" as const, a };
      }
      const onTrack = trackAt(x, y, 12 + slack);
      if (onTrack) return onTrack;
      let best: MapFlight | null = null;
      let bestD = 8 + slack;
      for (const f of fl) {
        const pts = routePoints(f);
        const step = Math.max(1, Math.floor(pts.length / 120));
        let prev: [number, number] | null = null;
        for (let i = 0; i < pts.length; i += step) {
          const p = pts[i]!;
          if (geoDistance(p, centre) > Math.PI / 2) {
            prev = null;
            continue;
          }
          const xy = proj(p) as [number, number] | null;
          if (!xy) continue;
          if (prev) {
            const d = segmentDistance(x, y, prev[0], prev[1], xy[0], xy[1]);
            if (d < bestD) [bestD, best] = [d, f];
          }
          prev = xy;
        }
      }
      return best ? { kind: "flight" as const, f: best } : null;
    };

    /** Whether two things under the pointer are the same. */
    const sameAs = (a: Hover, b: Hover) =>
      (a?.kind === "flight" && b?.kind === "flight" && a.f.id === b.f.id) ||
      (a?.kind === "spot" && b?.kind === "spot" && a.s.code === b.s.code) ||
      (a?.kind === "airport" && b?.kind === "airport" && a.a.id === b.a.id) ||
      (a?.kind === "sample" && b?.kind === "sample" && a.i === b.i) ||
      (a?.kind === "gap" && b?.kind === "gap" && a.g === b.g);

    const setHover = (h: Hover, e?: PointerEvent) => {
      if (!sameAs(st.hover, h)) {
        st.hover = h;
        st.dirty = true;
      }
      cv.style.cursor = h?.kind === "sample" || h?.kind === "gap" ? "crosshair" : h ? "pointer" : drag ? "grabbing" : "grab";
      if (h && e) {
        const tip =
          h.kind === "sample"
            ? sampleTip(data.current.samples, h.i, data.current.takeoff)
            : h.kind === "gap"
              ? gapTip(h.g)
              : h.kind === "flight"
                ? h.f.tip
                : h.kind === "spot"
                  ? h.s.tip
                  : `<strong>${escHtml(t("format.nameWithCode", { name: h.a.name, code: h.a.code }))}</strong><br><span class="muted">${escHtml(airportTip(data.current.flights, h.a.id, h.a.flights))}</span>`;
        showTip(tip, e.clientX, e.clientY, e.pointerType !== "mouse");
      } else hideTip();
    };

    const down = (e: PointerEvent) => {
      // Take focus for the arrow keys without the browser scrolling the globe into view.
      e.preventDefault();
      cv.focus({ preventScroll: true });
      cv.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      st.inertia = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), scale: st.scale, at: placeAt(st, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2) };
        drag = null;
        following = null;
      } else if (e.pointerType !== "mouse" && trackAt(p.x, p.y, 12 + FINGER)) {
        // A finger that lands on the track follows it, the globe still, as on the flat map.
        following = e.pointerId;
        drag = null;
        setHover(trackAt(p.x, p.y, 12 + FINGER), e);
      } else {
        drag = { x: p.x, y: p.y, rot: [...st.rot] as [number, number], moved: 0, t: performance.now(), coasting: false };
        last = { x: p.x, y: p.y, t: performance.now() };
        trail = [last];
      }
      cv.style.cursor = "grabbing";
    };

    const move = (e: PointerEvent) => {
      const p = local(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
      // The fingers' pinch zooms as far as they spread, the place between them staying between them.
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        scaleAbout(st, (pinch.scale * d) / pinch.dist, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2, pinch.at);
        return;
      }
      if (e.pointerId === following) {
        const h = trackAt(p.x, p.y, 64);
        if (h) setHover(h, e);
        return;
      }
      if (drag) {
        const k = 57.2958 / st.scale;
        const now = performance.now();
        // Moving again after coasting: the globe follows the pointer from where it has turned to.
        if (drag.coasting) {
          drag = { ...drag, x: p.x, y: p.y, rot: [...st.rot] as [number, number], coasting: false };
          st.inertia = 0;
          trail = [];
        }
        const dx = p.x - drag.x;
        const dy = p.y - drag.y;
        drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
        st.rot = [drag.rot[0] + dx * k, Math.max(-89, Math.min(89, drag.rot[1] - dy * k))];
        trail = [...trail.filter((q) => now - q.t < 80), { x: p.x, y: p.y, t: now }];
        const from = trail[0]!;
        const dt = Math.max(16, now - from.t);
        st.velocity = [((p.x - from.x) * k * 16) / dt, (-(p.y - from.y) * k * 16) / dt];
        last = { x: p.x, y: p.y, t: now };
        st.dirty = true;
        // A finger turning the globe puts away what a tap showed.
        if (drag.moved > 4) {
          if (e.pointerType !== "mouse" && st.hover) setHover(null);
          else hideTip();
        }
        // A trackpad's three-finger drag goes on for a moment after the fingers lift, without moving, before it ends.
        // A drag that stops while still fast coasts at once, as it would have on release.
        clearTimeout(still);
        if (e.pointerType === "mouse")
          still = setTimeout(() => {
            if (drag && !pinch && Math.hypot(...st.velocity) > 0.15) {
              drag.coasting = true;
              st.inertia = 1;
            }
          }, 50);
        return;
      }
      if (e.pointerType === "mouse") setHover(hitTest(p.x, p.y), e);
    };

    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      clearTimeout(still);
      if (e.pointerId === following) {
        following = null;
        return;
      }
      if (pinch && pointers.size < 2) {
        pinch = null;
        drag = null;
        return;
      }
      if (drag?.coasting) {
        drag = null;
      } else if (drag) {
        const p = local(e);
        const clicked = drag.moved < 5;
        const recent = performance.now() - last.t < 60;
        drag = null;
        if (clicked) {
          const finger = e.pointerType !== "mouse";
          const h = hitTest(p.x, p.y, finger ? FINGER : 0);
          // A finger's first tap on a route or a place shows its tooltip, as a mouse's hover does; a second opens it.
          if (finger && (h?.kind === "flight" || h?.kind === "airport" || h?.kind === "spot") && !sameAs(st.hover, h)) setHover(h, e);
          else if (h?.kind === "flight") data.current.onFlightClick?.(h.f);
          else if (h?.kind === "airport" && data.current.onAirportClick) {
            hideTip();
            data.current.onAirportClick(h.a.id);
          } else if (h?.kind === "spot" && data.current.onAirportClick) {
            hideTip();
            data.current.onAirportClick(h.s.airportId);
          } else setHover(h, e);
        } else if (recent && Math.hypot(...st.velocity) > 0.15) st.inertia = 1;
      }
      cv.style.cursor = "grab";
    };

    // The browser took the gesture, to scroll the page under a vertical swipe: the globe goes back to where the drag
    // began, without spinning on and without a click.
    const cancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      clearTimeout(still);
      following = null;
      if (drag) {
        st.rot = drag.rot;
        st.dirty = true;
      }
      drag = null;
      pinch = null;
      st.inertia = 0;
      hideTip();
      cv.style.cursor = "grab";
    };

    const leave = () => {
      if (!drag) setHover(null);
    };

    const wheel = (e: WheelEvent) => {
      // A trackpad pinch arrives as a wheel event with ctrlKey set, but in Safari as gesture events (below).
      if (data.current.contained && !e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (gesture !== null) return;
      // In pixels: a line as 16, a page as the stage's height. A pinch's small steps follow the fingers, as a touch
      // screen's pinch does, and a wheel's notch (about 100 pixels) zooms as the + button does (1.4 times). One event
      // zooms by 1.65 times at most, so a mouse's wheel with Ctrl, read as a pinch, does not leap.
      const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? st.height : 1);
      const per = e.ctrlKey ? 100 : 300;
      const p = local(e);
      scaleAbout(st, st.scale * Math.exp(-Math.max(-per / 2, Math.min(per / 2, px)) / per), p.x, p.y, placeAt(st, p.x, p.y));
    };

    // Safari's trackpad pinch, its scale from the gesture's start. A touch screen's pinch is the pointers' (above).
    const gestureStart = (e: Event) => {
      if (pointers.size) return;
      e.preventDefault();
      const p = local(e as Event & { clientX: number; clientY: number });
      gesture = { scale: st.scale, ...p, at: placeAt(st, p.x, p.y) };
    };
    const gestureChange = (e: Event) => {
      if (gesture === null) return;
      e.preventDefault();
      scaleAbout(st, gesture.scale * (e as Event & { scale: number }).scale, gesture.x, gesture.y, gesture.at);
    };
    const gestureEnd = (e: Event) => {
      if (gesture === null) return;
      e.preventDefault();
      gesture = null;
    };

    const key = (e: KeyboardEvent) => {
      const step = 8 * (st.fitScale / st.scale);
      if (e.key === "ArrowLeft") st.rot = [st.rot[0] + step, st.rot[1]];
      else if (e.key === "ArrowRight") st.rot = [st.rot[0] - step, st.rot[1]];
      else if (e.key === "ArrowUp") st.rot = [st.rot[0], Math.max(-89, st.rot[1] - step)];
      else if (e.key === "ArrowDown") st.rot = [st.rot[0], Math.min(89, st.rot[1] + step)];
      else if (e.key === "+" || e.key === "=") st.scale = within(st, st.scale * 1.25);
      else if (e.key === "-" || e.key === "_") st.scale = within(st, st.scale / 1.25);
      else if (e.key === "0") {
        st.rot = [...st.fitRot];
        st.scale = st.fitScale;
      } else return;
      e.preventDefault();
      st.dirty = true;
    };

    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", cancel);
    cv.addEventListener("pointerleave", leave);
    cv.addEventListener("wheel", wheel, { passive: false });
    const outside = whenTouchedOutside(cv, () => st.hover && setHover(null));
    cv.addEventListener("gesturestart", gestureStart);
    cv.addEventListener("gesturechange", gestureChange);
    cv.addEventListener("gestureend", gestureEnd);
    cv.addEventListener("keydown", key);
    return () => {
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointercancel", cancel);
      cv.removeEventListener("pointerleave", leave);
      cv.removeEventListener("wheel", wheel);
      outside();
      cv.removeEventListener("gesturestart", gestureStart);
      cv.removeEventListener("gesturechange", gestureChange);
      cv.removeEventListener("gestureend", gestureEnd);
      cv.removeEventListener("keydown", key);
      clearTimeout(still);
      hideTip();
    };
  }, []);

  return (
    <div className={`globe${contained ? " globe--contained" : ""}`} ref={wrap}>
      <canvas ref={canvas} className="globe__canvas" tabIndex={0} role="img" aria-label={label} />
    </div>
  );
});

