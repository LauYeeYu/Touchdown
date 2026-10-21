// Interactive globe: drag to turn, scroll or pinch to zoom, point at a route or a spotting location for
// details, click a route to open the flight. Arrow keys turn it and + / − zoom, for keyboard use.
// Drawn on a canvas with d3-geo (orthographic), from the same marks as the flat maps. Inside a page that
// scrolls (`contained`), scrolling and vertical swipes move the page; a pinch or Ctrl-scroll zooms.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { geoDistance, geoGraticule10, geoInterpolate, geoOrthographic, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { FeatureCollection } from "geojson";
import world from "world-atlas/countries-110m.json";
import type { MapFlight, MapSpot } from "./maps.tsx";
import { esc as escHtml, hideTip, showTip } from "./overlay.tsx";

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
  greatCircles?: [LonLat, LonLat][];
}

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
  return { sphere: v("--globe-sphere") || v("--sphere"), land: v("--land"), landEdge: v("--land-edge"), grid: v("--grid"), rule: v("--rule-strong"), flown: v("--flown"), spotted: v("--spotted"), ink: v("--ink"), ink2: v("--ink-2"), ink3: v("--ink-3"), paper: v("--paper") };
}

/** Points along a route, for hit testing and framing. */
function routePoints(f: MapFlight): LonLat[] {
  if (f.track) return f.track;
  const i = geoInterpolate(f.from, f.to);
  return Array.from({ length: 33 }, (_, k) => i(k / 32) as LonLat);
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

export const Globe = forwardRef<GlobeHandle, Props>(function Globe({ flights, spots, onFlightClick, onAirportClick, label, contained = false, greatCircles = [] }, handle) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef({
    rot: [0, 0] as [number, number],
    scale: 300,
    fitScale: 300,
    fitRot: [0, 0] as [number, number],
    width: 0,
    height: 0,
    hover: null as { kind: "flight"; f: MapFlight } | { kind: "spot"; s: MapSpot } | { kind: "airport"; a: AirportMark } | null,
    dirty: true,
    colours: null as Colours | null,
    velocity: [0, 0] as [number, number],
    inertia: 0,
  });
  const data = useRef({ flights, spots, onFlightClick, onAirportClick, contained, greatCircles });
  data.current = { flights, spots, onFlightClick, onAirportClick, contained, greatCircles };

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
      st.scale = Math.min(st.fitScale * 40, Math.max(Math.min(st.width, st.height) * 0.3, st.scale * factor));
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

      if (gc.length) {
        ctx.strokeStyle = c.ink3;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        for (const [a, b] of gc) path({ type: "LineString", coordinates: [a, b] });
        ctx.stroke();
        ctx.setLineDash([]);
      }

      const hoverId = st.hover?.kind === "flight" ? st.hover.f.id : null;
      const lineWidth = Math.min(3, 1.4 + Math.log2(Math.max(1, zoom)) * 0.4);
      const drawRoute = (f: MapFlight, width: number, alpha: number) => {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = c.flown;
        ctx.lineWidth = width;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.setLineDash([]);
        ctx.beginPath();
        path({ type: "LineString", coordinates: f.track ?? [f.from, f.to] });
        ctx.stroke();
        if (f.gaps?.length) {
          ctx.setLineDash([2, 4]);
          ctx.beginPath();
          for (const g of f.gaps) path({ type: "LineString", coordinates: g });
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.globalAlpha = 1;
      };
      for (const f of fl) if (f.id !== hoverId) drawRoute(f, lineWidth, hoverId ? 0.22 : 0.85);
      const hovered = hoverId ? fl.find((f) => f.id === hoverId) : undefined;
      if (hovered) drawRoute(hovered, lineWidth + 1.6, 1);

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
      ctx.font = "600 11px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
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
    let drag: { x: number; y: number; rot: [number, number]; moved: number; t: number } | null = null;
    let pinch: { dist: number; scale: number } | null = null;
    let last = { x: 0, y: 0, t: 0 };

    const local = (e: PointerEvent | WheelEvent) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const hitTest = (x: number, y: number) => {
      const proj = geoOrthographic().clipAngle(90).rotate([st.rot[0], st.rot[1], 0]).scale(st.scale).translate([st.width / 2, st.height / 2]);
      const centre: LonLat = [-st.rot[0], -st.rot[1]];
      const { flights: fl, spots: sp } = data.current;
      const maxAircraft = Math.max(1, ...sp.map((s) => s.aircraft));
      for (const s of sp) {
        if (geoDistance(s.at, centre) > Math.PI / 2) continue;
        const xy = proj(s.at);
        if (xy && Math.hypot(xy[0] - x, xy[1] - y) < 4 + 9 * Math.sqrt(s.aircraft / maxAircraft) + 3) return { kind: "spot" as const, s };
      }
      for (const a of airportMarks(fl, sp)) {
        if (!a.flights || geoDistance(a.at, centre) > Math.PI / 2) continue;
        const xy = proj(a.at);
        if (xy && Math.hypot(xy[0] - x, xy[1] - y) < 9) return { kind: "airport" as const, a };
      }
      let best: MapFlight | null = null;
      let bestD = 8;
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

    const setHover = (h: ReturnType<typeof hitTest>, e?: PointerEvent) => {
      const prev = st.hover;
      const same =
        (prev?.kind === "flight" && h?.kind === "flight" && prev.f.id === h.f.id) ||
        (prev?.kind === "spot" && h?.kind === "spot" && prev.s.code === h.s.code) ||
        (prev?.kind === "airport" && h?.kind === "airport" && prev.a.id === h.a.id);
      if (!same) {
        st.hover = h;
        st.dirty = true;
      }
      cv.style.cursor = h ? "pointer" : drag ? "grabbing" : "grab";
      if (h && e) {
        const tip =
          h.kind === "flight"
            ? h.f.tip
            : h.kind === "spot"
              ? h.s.tip
              : `<strong>${escHtml(h.a.name)} (${escHtml(h.a.code)})</strong><br><span class="muted">${h.a.flights} flight${h.a.flights === 1 ? "" : "s"} in this period · click for the airport page</span>`;
        showTip(tip, e.clientX, e.clientY);
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
        pinch = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), scale: st.scale };
        drag = null;
      } else {
        drag = { x: p.x, y: p.y, rot: [...st.rot] as [number, number], moved: 0, t: performance.now() };
        last = { x: p.x, y: p.y, t: performance.now() };
      }
      cv.style.cursor = "grabbing";
    };

    const move = (e: PointerEvent) => {
      const p = local(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        st.scale = Math.min(st.fitScale * 40, Math.max(Math.min(st.width, st.height) * 0.3, (pinch.scale * d) / pinch.dist));
        st.dirty = true;
        return;
      }
      if (drag) {
        const k = 57.2958 / st.scale;
        const dx = p.x - drag.x;
        const dy = p.y - drag.y;
        drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
        st.rot = [drag.rot[0] + dx * k, Math.max(-89, Math.min(89, drag.rot[1] - dy * k))];
        const now = performance.now();
        const dt = Math.max(1, now - last.t);
        st.velocity = [((p.x - last.x) * k * 16) / dt, (-(p.y - last.y) * k * 16) / dt];
        last = { x: p.x, y: p.y, t: now };
        st.dirty = true;
        if (drag.moved > 4) hideTip();
        return;
      }
      if (e.pointerType === "mouse") setHover(hitTest(p.x, p.y), e);
    };

    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pinch && pointers.size < 2) {
        pinch = null;
        drag = null;
        return;
      }
      if (drag) {
        const p = local(e);
        const clicked = drag.moved < 5;
        const recent = performance.now() - last.t < 60;
        drag = null;
        if (clicked) {
          const h = hitTest(p.x, p.y);
          if (h?.kind === "flight") data.current.onFlightClick?.(h.f);
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

    const leave = () => {
      if (!drag) setHover(null);
    };

    const wheel = (e: WheelEvent) => {
      // A trackpad pinch arrives as a wheel event with ctrlKey set.
      if (data.current.contained && !e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      st.scale = Math.min(st.fitScale * 40, Math.max(Math.min(st.width, st.height) * 0.3, st.scale * Math.exp(-e.deltaY * 0.0015)));
      st.dirty = true;
    };

    const key = (e: KeyboardEvent) => {
      const step = 8 * (st.fitScale / st.scale);
      if (e.key === "ArrowLeft") st.rot = [st.rot[0] + step, st.rot[1]];
      else if (e.key === "ArrowRight") st.rot = [st.rot[0] - step, st.rot[1]];
      else if (e.key === "ArrowUp") st.rot = [st.rot[0], Math.max(-89, st.rot[1] - step)];
      else if (e.key === "ArrowDown") st.rot = [st.rot[0], Math.min(89, st.rot[1] + step)];
      else if (e.key === "+" || e.key === "=") st.scale = Math.min(st.fitScale * 40, st.scale * 1.25);
      else if (e.key === "-" || e.key === "_") st.scale = Math.max(Math.min(st.width, st.height) * 0.3, st.scale / 1.25);
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
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("pointerleave", leave);
    cv.addEventListener("wheel", wheel, { passive: false });
    cv.addEventListener("keydown", key);
    return () => {
      cv.removeEventListener("pointerdown", down);
      cv.removeEventListener("pointermove", move);
      cv.removeEventListener("pointerup", up);
      cv.removeEventListener("pointercancel", up);
      cv.removeEventListener("pointerleave", leave);
      cv.removeEventListener("wheel", wheel);
      cv.removeEventListener("keydown", key);
      hideTip();
    };
  }, []);

  return (
    <div className={`globe${contained ? " globe--contained" : ""}`} ref={wrap}>
      <canvas ref={canvas} className="globe__canvas" tabIndex={0} role="img" aria-label={label} />
    </div>
  );
});

