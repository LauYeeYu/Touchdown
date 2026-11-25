// A stamp, drawn as a passport stamp (DESIGN.md, "Stamps"; docs/31, "Stamps"): a ring in the stamp's ink, two half
// circles so a stamp of both inks is gold and blue, the emblem inside (the type's silhouette, an airport's code, a few
// characters or a drawing), a line of words above it and the date below. Earned, it is tilted a little, always by
// the same angle; not yet, it is a dashed outline without words.

import { useMemo } from "react";
import { makerName, type Stamp } from "@touchdown/core/view";
import { useApp } from "../data/context.tsx";
import { primaryCode } from "../lib/codes.ts";
import { STAMP_GLYPHS } from "../lib/stampGlyphs.tsx";
import { useTypeInfo } from "../lib/typeInfo.ts";
import { drawingOf } from "./Silhouette.tsx";

/** The months as passports and park stamps print them, after ICAO's passports (Doc 9303): three letters, in English. */
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** A day as a stamp prints it: "03 DEC 2025", the same in every language, as on a passport or a park's stamp. */
export function stampDate(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** The same small tilt for a stamp every time, from its id: up to 6° either way, never quite upright. */
function tiltOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const a = ((h >>> 0) % 1000) / 1000;
  return Math.round((a * 2 - 1) * 60) / 10 || 2;
}

export function StampMark({ stamp, size = 128, words = true }: { stamp: Stamp; size?: number; words?: boolean }) {
  const { app } = useApp();
  const info = useTypeInfo();
  const { emblem } = stamp;
  const earned = !!stamp.by;
  const drawing = useMemo(() => (emblem.kind === "type" ? drawingOf(emblem.code, info, app.ref) : null), [emblem, info, app.ref]);
  // The words inside only where there is room for them, and only once earned.
  const inside = words && earned && size >= 120;
  const top = inside ? (stamp.factory ? makerName(stamp.factory.maker) : emblem.kind === "type" ? emblem.code : "") : "";
  // The date as passports and park stamps print it ("14 MAR 2025"); the cell under the stamp gives it in the reader's way.
  const date = inside && stamp.by?.day ? stampDate(stamp.by.day) : "";
  const text = emblem.kind === "airport" ? primaryCode(app.ref.airport(emblem.id)) : emblem.kind === "text" ? emblem.text : null;

  // A small stamp (a flight's page) keeps one thick ring and a larger emblem, so it still reads at 28px.
  const tiny = size < 64;
  const [at, side] = tiny ? [22, 84] : [36, 56];
  let mark: React.ReactNode = null;
  if (drawing) {
    const [x0, y0, x1, y1] = drawing.extent;
    const extent = Math.max(x1 - x0, y1 - y0) * 1.08;
    const view = `${(x0 + x1) / 2 - extent / 2} ${(y0 + y1) / 2 - extent / 2} ${extent} ${extent}`;
    mark = (
      <svg x={at} y={at} width={side} height={side} viewBox={view}>
        <path className="stamp__fill" d={drawing.path} fillRule="nonzero" />
      </svg>
    );
  } else if (emblem.kind === "glyph") {
    mark = <svg x={tiny ? 26 : 40} y={tiny ? 26 : 40} width={tiny ? 76 : 48} height={tiny ? 76 : 48} viewBox="0 0 24 24" className="stamp__glyph" dangerouslySetInnerHTML={{ __html: STAMP_GLYPHS[emblem.glyph] }} />;
  } else {
    const code = text ?? (emblem.kind === "type" ? emblem.code : "");
    mark = (
      <text className="stamp__code" x={64} y={64} dominantBaseline="central" textAnchor="middle" fontSize={(code.length > 4 ? 22 : code.length === 1 ? 46 : 30) * (tiny ? 1.5 : 1)}>
        {code}
      </text>
    );
  }

  return (
    <svg
      className={`stamp stamp--${stamp.ink}${earned ? "" : " stamp--not-yet"}${tiny ? " stamp--tiny" : ""}`}
      viewBox="0 0 128 128"
      width={size}
      height={size}
      // The tilt as a variable, so the first press can turn the stamp onto it (stamps.css).
      style={earned ? ({ "--tilt": `${tiltOf(stamp.id)}deg` } as React.CSSProperties) : undefined}
      aria-hidden="true"
    >
      <path className="stamp__ring stamp__ring--a" d="M64 4A60 60 0 0 0 64 124" />
      <path className="stamp__ring stamp__ring--b" d="M64 4A60 60 0 0 1 64 124" />
      {earned && !tiny && (
        <>
          <path className="stamp__inner stamp__ring--a" d="M64 10A54 54 0 0 0 64 118" />
          <path className="stamp__inner stamp__ring--b" d="M64 10A54 54 0 0 1 64 118" />
        </>
      )}
      {top && (
        <text className="stamp__words" x={64} y={31} textAnchor="middle">
          {top}
        </text>
      )}
      {mark}
      {date && (
        <text className="stamp__words" x={64} y={103} textAnchor="middle">
          {date}
        </text>
      )}
    </svg>
  );
}
