// A family or a type in the types pages' lists (docs/31-ui.md, "Aircraft types"): its silhouette, its name and codes,
// the span of its main figures (with its first flight on a manufacturer's page), and for a member how often the log has it.
// A family's row opens the family's page, a type's row the type's.

import { t } from "@touchdown/i18n";
import { useApp } from "../data/context.tsx";
import { Link } from "../lib/link.tsx";
import { nf } from "../lib/format.ts";
import { metres, metresBetween, spanOf } from "../lib/typeFigures.ts";
import { useTypeInfo } from "../lib/typeInfo.ts";
import { slugOf, type TypeEntry } from "../lib/typeEntries.ts";
import { Silhouette } from "./Silhouette.tsx";

/** "1 piston engine", "2 turboprops": a type's engines from the reference data, where it has no figures. */
export function enginesOf(type: { engineType: string | null; engineCount: number | null } | null | undefined): string | null {
  if (!type?.engineType || !type.engineCount) return null;
  const kind = ["jet", "turboprop", "piston", "electric"].includes(type.engineType) ? type.engineType : "other";
  return t("aircraft.types.engines", { count: type.engineCount, kind });
}

export function TypeRow({ entry, counts, firstFlight = false }: { entry: TypeEntry; counts: boolean; firstFlight?: boolean }) {
  const { app } = useApp();
  const info = useTypeInfo();
  const { codes, flown, seen } = entry;
  const specs = codes.map((c) => info?.specs(c) ?? null);
  const length = spanOf(specs.map((s) => s?.lengthM ?? null), metres, metresBetween);
  const seats = spanOf(specs.map((s) => s?.seatsTypical ?? s?.seatsMax ?? null), (n) => nf.format(n));
  const figures = [
    firstFlight && entry.firstFlight && t("aircraft.types.row.firstFlight", { year: entry.firstFlight.slice(0, 4) }),
    length && t("aircraft.types.row.length", { length }),
    seats && t("aircraft.types.row.seats", { seats }),
  ].filter(Boolean);
  // Without a length or seats, what the reference data says of its engines.
  if (!length && !seats) {
    const engines = enginesOf(app.ref.type(entry.main));
    if (engines) figures.push(engines);
  }
  const to = entry.family ? ({ to: "/types/families/$family", params: { family: slugOf(entry.family.name) } } as const) : ({ to: "/types/$code", params: { code: entry.main } } as const);
  return (
    <li>
      <Link className="row type-row" {...to}>
        <Silhouette code={entry.drawn} size={52} className="type-row__shape" />
        <span className="type-row__name">
          <b>{entry.name}</b>
          <span className="type-row__codes">{entry.family ? codes.join(" · ") : app.ref.type(entry.main) && entry.main}</span>
        </span>
        <span className="type-row__figures">{figures.join(" · ")}</span>
        {counts && (
          <span className="row__num tabular">
            {flown > 0 && <span className="dot dot--flown" />}
            {flown || "—"}
          </span>
        )}
        {counts && (
          <span className="row__num tabular">
            {seen > 0 && <span className="dot dot--spotted" />}
            {seen || "—"}
          </span>
        )}
      </Link>
    </li>
  );
}
