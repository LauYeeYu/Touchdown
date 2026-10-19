// One fact in a fact list (<dl className="facts">): a label, the value, and an optional detail line.

import type { ReactNode } from "react";
import { plural } from "../lib/format.ts";

export function Fact({ label, value, detail }: { label: ReactNode; value: ReactNode; detail?: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <span className="facts__value">{value}</span>
        {detail && <span className="facts__detail">{detail}</span>}
      </dd>
    </div>
  );
}

/** "3 records left out (no airline)": records a count could not include. Nothing when there are none. */
export function LeftOut({ m, what }: { m: { leftOut: number }; what: string }) {
  if (!m.leftOut) return null;
  return (
    <span className="left-out">
      {plural(m.leftOut, "record")} left out (no {what})
    </span>
  );
}
