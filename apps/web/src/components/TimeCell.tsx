// A time on a flight's page: the label, the local clock, the local day and the UTC offset (DESIGN.md, "Times strip").

import type { ReactNode } from "react";
import { clock, dayShort, localDay, offsetLabel } from "../lib/format.ts";

export function TimeCell({ label, dt, extra }: { label: string; dt: string; extra?: ReactNode }) {
  const day = localDay(dt)!;
  return (
    <div className="time">
      <p className="time__label">{label}</p>
      <p className="time__clock">{clock(dt)}</p>
      <p className="time__date">
        {dayShort(day)} · {offsetLabel(dt)}
      </p>
      {extra}
    </div>
  );
}
