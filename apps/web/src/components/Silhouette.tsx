// A type's silhouette from above (lib/silhouette.ts, G11): fitted to a square box (`size`, the aircraft list, the types'
// rows), filling more of it the larger the aircraft, or at a scale (`scale` pixels a metre) so types drawn side by side
// compare as they are (a family's table, Compare). Nothing for a type not drawn, and an empty box of the same size while
// the types' information loads. Hovered, its moving parts move: rotors spin, a swing wing sweeps back, folding wings
// fold up, a tiltrotor's nacelles turn up (lib/motion.ts).

import { useMemo, useRef } from "react";
import type { RefIndex } from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import { extentOf, movedParts, planformLayers, planformPath } from "../lib/silhouette.ts";
import { useTypeMotion, type TypeMove } from "../lib/motion.ts";
import { useTypeInfo, type TypeInfo } from "../lib/typeInfo.ts";

/**
 * How much of its box a fitted silhouette fills: `least` for the smallest aircraft, and the rest of the box by its
 * longer side (span or length) over `largest`'s metres, to `power`. With these, an A380 fills the box, a 777-300ER 0.94
 * of it, an A330 0.85, an A220 or a 737-800 0.65, an ATR 72 0.57, a King Air 0.52 and a Cessna 172 0.49. A larger
 * `least` draws small aircraft larger; a larger `power` keeps more of the box for the largest. Tune here.
 */
export const FIT = { largest: 80, power: 1.4, least: 0.45 };

/** The share of its box a fitted silhouette `metres` across fills. */
export function fitShare(metres: number): number {
  return FIT.least + (1 - FIT.least) * Math.min(1, metres / FIT.largest) ** FIT.power;
}

/**
 * A type's outline (`path`), its still parts and its moving ones apart, its extent in metres, and with its moving parts
 * where a hover takes them (a swing wing swept, wings folded), and whether it is checked.
 */
export type Drawn = { path: string; still: string; moving: TypeMove[]; extent: [number, number, number, number]; movedExtent: [number, number, number, number]; checked: boolean };
const drawn = new Map<string, Drawn | null>();

/** A type's outline and extent in metres, worked out once a tab. */
export function drawingOf(code: string | null | undefined, info: TypeInfo | null, ref: RefIndex): Drawn | null {
  if (!code || !info) return null;
  if (!drawn.has(code)) {
    const p = info.planform(code, ref);
    if (!p) drawn.set(code, null);
    else {
      const { still, moving } = planformLayers(p);
      const parts = [...still, ...moving.flatMap((m) => m.parts)];
      const moves = moving.map((m): TypeMove => {
        const { parts, ...how } = m;
        if (how.kind === "proprotor") return { ...how, path: planformPath(parts), blades: planformPath(how.blades) };
        if (how.kind === "fold") return { ...how, path: planformPath(parts), outline: parts[0]! };
        return { ...how, path: planformPath(parts) };
      });
      drawn.set(code, { path: planformPath(parts), still: planformPath(still), moving: moves, extent: extentOf(parts), movedExtent: extentOf([...still, ...movedParts(moving)]), checked: p.checked });
    }
  }
  return drawn.get(code)!;
}

/** No moving parts. */
const NONE: TypeMove[] = [];

/** A drawing's outline: one path, or its still parts and each moving part on its own, for `useTypeMotion` to move. */
export function DrawingShape({ d, className }: { d: Drawn; className?: string }) {
  if (!d.moving.length) return <path className={className} d={d.path} fillRule="nonzero" />;
  return (
    <>
      <path className={className} d={d.still} fillRule="nonzero" />
      {d.moving.map((m, i) => (
        <path key={i} className={className} d={m.path} fillRule="nonzero" data-moving="" />
      ))}
    </>
  );
}

export function Silhouette({ code, size, scale, className = "", label }: { code: string | null | undefined; size?: number; scale?: number; className?: string; label?: string }) {
  const { app } = useApp();
  const info = useTypeInfo();
  const d = useMemo(() => drawingOf(code, info, app.ref), [code, info, app.ref]);
  const svg = useRef<SVGSVGElement>(null);
  useTypeMotion(svg, d?.moving ?? NONE);
  if (!d) return size ? <span className={`silhouette silhouette--empty ${className}`} style={{ width: size, height: size }} aria-hidden="true" /> : null;
  const [x0, y0, x1, y1] = d.extent;
  const w = x1 - x0;
  const h = y1 - y0;
  // Fitted: the longer side fills its share of the box, the drawing centred in it. At a scale: as large as its metres say.
  const side = Math.max(w, h) / fitShare(Math.max(w, h));
  const view = size ? `${x0 - (side - w) / 2} ${y0 - (side - h) / 2} ${side} ${side}` : `${x0} ${y0} ${w} ${h}`;
  const width = size ?? w * (scale ?? 4);
  const height = size ?? h * (scale ?? 4);
  return (
    <svg ref={svg} className={`silhouette ${className}`} viewBox={view} width={width} height={height} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <DrawingShape d={d} />
    </svg>
  );
}
