// One fact in a fact list (<dl className="facts">): a label, the value, and an optional detail line.

import type { ReactNode } from "react";
import { t } from "@touchdown/i18n";

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

/**
 * "3 records left out (no airline)": records a count could not include. Nothing when there are none. `what` is the
 * field they lack: airline, airport, airports, type, cabin, location, registration, phase, times or seat position.
 */
export function LeftOut({ m, what }: { m: { leftOut: number }; what: string }) {
  if (!m.leftOut) return null;
  return (
    <span className="left-out">{t("airport.facts.leftOut", { count: m.leftOut, kind: what.replace(/ /g, "_"), what })}</span>
  );
}
