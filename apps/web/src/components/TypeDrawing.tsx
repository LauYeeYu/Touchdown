// A type's silhouette as a measured drawing (docs/31-ui.md, "Aircraft types"): seen from above on its panel, its span
// marked across the top and its length down the side as a drawing office would, with a scale bar. A dimension is marked
// only where the type's own figures give it, not one drawn with a sibling's (docs/13, "Silhouettes"). The words keep
// their size whatever the aircraft's, sized from the drawing's width on the screen.

import { useEffect, useRef, useState } from "react";
import { t } from "@touchdown/i18n";
import { metres } from "../lib/typeFigures.ts";

/** A round length for the scale bar: about a fifth of the drawing's width. */
function barLength(width: number): number {
  const target = width / 5;
  const steps = [1, 2, 5, 10, 20, 25, 50];
  return steps.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best), steps[0]!);
}

export function TypeDrawing({ path, extent, length, span, rotor, label }: { path: string; extent: [number, number, number, number]; length: number | null; span: number | null; rotor: boolean; label: string }) {
  const box = useRef<SVGSVGElement>(null);
  // The drawing's size on the screen: it is fitted into its box by width or by height, whichever is tighter.
  const [shown, setShown] = useState<[number, number]>([600, 400]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setShown([r.width || 600, r.height || 400]);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [x0, y0, x1, y1] = extent;
  const w = x1 - x0;
  const h = y1 - y0;
  // Room around the drawing for the dimension lines and their words, in metres.
  const room = Math.max(w, h) * 0.14;
  const vb = { x: x0 - room * 0.4, y: y0 - room, w: w + room * 1.9, h: h + room * 1.8 };
  const u = Math.max(vb.w / shown[0], vb.h / shown[1]); // metres a pixel on the screen
  const font = 13 * u;
  const tick = 6 * u;
  const lineY = y0 - room * 0.45;
  const lineX = x1 + room * 0.55;
  const bar = barLength(w);
  const barY = y1 + room * 0.55;
  return (
    <svg ref={box} className="type-drawing" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} role="img" aria-label={label}>
      <path className="type-drawing__shape" d={path} fillRule="nonzero" />
      <g className="type-drawing__dims" strokeWidth={1.25 * u}>
        {/* The span across the top, from tip to tip. */}
        {span !== null && (
          <>
            <line x1={x0} y1={lineY} x2={x1} y2={lineY} />
            <line x1={x0} y1={lineY - tick} x2={x0} y2={lineY + tick} />
            <line x1={x1} y1={lineY - tick} x2={x1} y2={lineY + tick} />
            <text x={(x0 + x1) / 2} y={lineY - 6 * u} fontSize={font} textAnchor="middle">
              {t("aircraft.types.drawing.span", { rotor: rotor ? "yes" : "no", length: metres(span) })}
            </text>
          </>
        )}
        {/* The length down the side, from nose to tail. */}
        {length !== null && (
          <>
            <line x1={lineX} y1={y0} x2={lineX} y2={y1} />
            <line x1={lineX - tick} y1={y0} x2={lineX + tick} y2={y0} />
            <line x1={lineX - tick} y1={y1} x2={lineX + tick} y2={y1} />
            <text x={lineX + 8 * u} y={(y0 + y1) / 2} fontSize={font} textAnchor="middle" transform={`rotate(90 ${lineX + 8 * u} ${(y0 + y1) / 2})`}>
              {t("aircraft.types.drawing.length", { length: metres(length) })}
            </text>
          </>
        )}
        {/* A scale bar under the tail's left. */}
        <line x1={x0} y1={barY} x2={x0 + bar} y2={barY} strokeWidth={3 * u} />
        <text x={x0 + bar + 8 * u} y={barY + font * 0.35} fontSize={font}>
          {metres(bar)}
        </text>
      </g>
    </svg>
  );
}
