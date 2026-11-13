// A type's silhouette from above (lib/silhouette.ts, G11): fitted to a square box (`size`, the aircraft list, the types'
// rows), filling more of it the larger the aircraft, or at a scale (`scale` pixels a metre) so types drawn side by side
// compare as they are (a family's table, Compare). Nothing for a type not drawn, and an empty box of the same size while
// the types' information loads.

import { useMemo } from "react";
import type { RefIndex } from "@touchdown/core";
import { useApp } from "../data/context.tsx";
import { extentOf, planformParts, planformPath } from "../lib/silhouette.ts";
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

type Drawn = { path: string; extent: [number, number, number, number]; checked: boolean };
const drawn = new Map<string, Drawn | null>();

/** A type's outline and extent in metres, worked out once a tab. */
export function drawingOf(code: string | null | undefined, info: TypeInfo | null, ref: RefIndex): Drawn | null {
  if (!code || !info) return null;
  if (!drawn.has(code)) {
    const p = info.planform(code, ref);
    if (!p) drawn.set(code, null);
    else {
      const parts = planformParts(p);
      drawn.set(code, { path: planformPath(parts), extent: extentOf(parts), checked: p.checked });
    }
  }
  return drawn.get(code)!;
}

export function Silhouette({ code, size, scale, className = "", label }: { code: string | null | undefined; size?: number; scale?: number; className?: string; label?: string }) {
  const { app } = useApp();
  const info = useTypeInfo();
  const d = useMemo(() => drawingOf(code, info, app.ref), [code, info, app.ref]);
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
    <svg className={`silhouette ${className}`} viewBox={view} width={width} height={height} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d={d.path} fillRule="nonzero" />
    </svg>
  );
}
