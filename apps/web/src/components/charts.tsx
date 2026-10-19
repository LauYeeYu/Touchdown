// Small charts, drawn as in the prototype: thin bars with rounded tops anchored to the baseline, one direct
// label on the highest bar, recessive grid, and a hover tooltip per month.

import { useEffect, useRef } from "react";
import { scaleLinear } from "d3-scale";
import { MONTHS, MONTHS_LONG, nf, plural } from "../lib/format.ts";
import { hideTip, showTip } from "./overlay.tsx";

const SVG_NS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
}

function roundedTopBar(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return "";
  r = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

interface MonthChartProps {
  values: number[]; // 12
  color: string;
  unitOne: string;
  unitMany: string;
  futureFrom: number | null; // first month index not yet reached, for the current year
  yearLabel: string;
}

export function MonthChart({ values, color, unitOne, unitMany, futureFrom, yearLabel }: MonthChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const key = values.join(",") + `|${futureFrom}|${yearLabel}`;
  useEffect(() => {
    const container = host.current!;
    const draw = () => {
      const width = Math.max(280, container.clientWidth);
      const height = 168;
      const m = { top: 20, right: 4, bottom: 24, left: 28 };
      const iw = width - m.left - m.right;
      const ih = height - m.top - m.bottom;
      const y = scaleLinear().domain([0, Math.max(1, ...values)]).nice(3).range([ih, 0]);
      const band = iw / 12;
      const bw = Math.min(28, band * 0.58);
      let svg = container.querySelector("svg");
      if (!svg) svg = el(container, "svg", {});
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));
      svg.replaceChildren();
      const g = el(svg, "g", { transform: `translate(${m.left},${m.top})` });
      const ticks = y.ticks(3);
      const grid = el(g, "g", { class: "grid" });
      const axis = el(g, "g", { class: "axis" });
      for (const t of ticks) {
        el(grid, "line", { x1: 0, x2: iw, y1: y(t), y2: y(t) });
        el(axis, "text", { x: -8, y: y(t) + 4, "text-anchor": "end" }).textContent = nf.format(t);
      }
      const max = Math.max(...values);
      const maxIndex = values.indexOf(max);
      const bars: SVGPathElement[] = [];
      values.forEach((v, i) => {
        const cx = band * i + band / 2;
        const future = futureFrom !== null && i >= futureFrom;
        if (future) el(g, "line", { class: "future", x1: cx - bw / 2 + 2, x2: cx + bw / 2 - 2, y1: ih, y2: ih });
        else if (v > 0) bars.push(el(g, "path", { class: "bar", "data-i": i, fill: color, d: roundedTopBar(cx - bw / 2, y(v), bw, ih - y(v), 4) }));
        if (i === maxIndex && v > 0) el(g, "text", { class: "bar-label", x: cx, y: y(v) - 6, "text-anchor": "middle" }).textContent = nf.format(v);
        el(g, "text", { class: "tick-label", x: cx, y: ih + 17, "text-anchor": "middle" }).textContent = MONTHS[i]![0]!;
        const hit = el(g, "rect", { class: "bar-hit", x: band * i, y: -m.top, width: band, height: ih + m.top + 20 });
        const tip = `<strong>${MONTHS_LONG[i]}${yearLabel ? " " + yearLabel : ""}</strong><br><span class="muted">${future ? "Not yet" : plural(v, unitOne, unitMany)}</span>`;
        const enter = (ev: PointerEvent) => {
          for (const b of bars) b.classList.toggle("is-dim", Number(b.dataset.i) !== i);
          showTip(tip, ev.clientX, ev.clientY);
        };
        hit.addEventListener("pointerenter", enter);
        hit.addEventListener("pointermove", enter);
        hit.addEventListener("pointerleave", () => {
          for (const b of bars) b.classList.remove("is-dim");
          hideTip();
        });
      });
    };
    draw();
    let last = container.clientWidth;
    const ro = new ResizeObserver(() => {
      if (container.clientWidth !== last) {
        last = container.clientWidth;
        draw();
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, color]);
  return <div ref={host} className="chart__plot" />;
}

interface AltitudePoint {
  min: number; // minutes after the first point
  alt: number; // feet
  gs: number | null; // knots
  clock: string; // local time at the departure airport
}

/** Altitude over the flight from a recorded track, with a crosshair tooltip. */
export function AltitudeChart({ points }: { points: AltitudePoint[] }) {
  const host = useRef<HTMLDivElement>(null);
  const key = `${points.length}|${points[0]?.min}|${points[points.length - 1]?.min}`;
  useEffect(() => {
    const container = host.current!;
    const draw = () => {
      const width = Math.max(280, container.clientWidth);
      const height = 200;
      const m = { top: 12, right: 8, bottom: 26, left: 44 };
      const iw = width - m.left - m.right;
      const ih = height - m.top - m.bottom;
      const total = Math.max(1, points[points.length - 1]?.min ?? 1);
      const maxAlt = Math.max(42000, ...points.map((p) => p.alt));
      const x = scaleLinear().domain([0, total]).range([0, iw]);
      const y = scaleLinear().domain([0, maxAlt]).range([ih, 0]);
      let svg = container.querySelector("svg");
      if (!svg) svg = el(container, "svg", {});
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(height));
      svg.replaceChildren();
      const g = el(svg, "g", { transform: `translate(${m.left},${m.top})` });
      const grid = el(g, "g", { class: "grid" });
      const axis = el(g, "g", { class: "axis" });
      for (const t of [0, 10000, 20000, 30000, 40000]) {
        el(grid, "line", { x1: 0, x2: iw, y1: y(t), y2: y(t) });
        el(axis, "text", { x: -8, y: y(t) + 4, "text-anchor": "end" }).textContent = t ? `${t / 1000}k ft` : "0";
      }
      const step = total > 600 ? 120 : 60;
      for (let h = step; h < total; h += step) el(axis, "text", { x: x(h), y: ih + 18, "text-anchor": "middle" }).textContent = `${h / 60} h`;
      const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.min).toFixed(1)},${y(p.alt).toFixed(1)}`).join("");
      el(g, "path", { class: "area", d: `${line}L${x(total)},${ih}L0,${ih}Z` });
      el(g, "path", { class: "line", d: line });
      const cross = el(g, "line", { class: "crosshair", y1: 0, y2: ih, style: "display:none" });
      const dot = el(g, "circle", { class: "cursor-dot", r: 4.5, style: "display:none" });
      const hit = el(g, "rect", { width: iw, height: ih, fill: "transparent" });
      hit.addEventListener("pointermove", (ev) => {
        const r = hit.getBoundingClientRect();
        const t = x.invert(ev.clientX - r.left);
        let best = points[0]!;
        for (const p of points) if (Math.abs(p.min - t) < Math.abs(best.min - t)) best = p;
        cross.setAttribute("style", "");
        cross.setAttribute("x1", String(x(best.min)));
        cross.setAttribute("x2", String(x(best.min)));
        dot.setAttribute("style", "");
        dot.setAttribute("cx", String(x(best.min)));
        dot.setAttribute("cy", String(y(best.alt)));
        const h = Math.floor(best.min / 60);
        const mm = Math.round(best.min % 60);
        showTip(`<strong>${nf.format(best.alt)} ft${best.gs !== null ? ` · ${best.gs} kt` : ""}</strong><br><span class="muted">${h ? `${h} h ` : ""}${mm} min after the first point · ${best.clock}</span>`, ev.clientX, ev.clientY);
      });
      hit.addEventListener("pointerleave", () => {
        cross.setAttribute("style", "display:none");
        dot.setAttribute("style", "display:none");
        hideTip();
      });
    };
    draw();
    let last = container.clientWidth;
    const ro = new ResizeObserver(() => {
      if (container.clientWidth !== last) {
        last = container.clientWidth;
        draw();
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return <div ref={host} className="chart__plot" />;
}
