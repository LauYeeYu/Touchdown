// A special livery given the stage (DESIGN.md, "Special livery band"): the aircraft's reference photo beside the
// livery's name and how often the user flew on it or photographed it in that livery. On a flight in a special livery
// it sits between the lead sentence and the map, and opens the aircraft's page as its card does; on the aircraft's page
// it sits under the sentence.

import type { ReactNode } from "react";
import { dayMonthYear, plural } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { Credit, Photo } from "./Photo.tsx";

export interface LiveryFact {
  label: string;
  value: string;
}

/**
 * `linked`: `about` holds a link with the `stretch__link` class, stretched over the whole band (DESIGN.md, "Cards"),
 * so the band opens what it links to and the credit's link stays above it.
 */
export function LiveryBand({ names, reg, alt, about, facts, linked = false }: { names: string[]; reg: string | null; alt: string; about: ReactNode; facts: LiveryFact[]; linked?: boolean }) {
  return (
    <section className={`livery-band${linked ? " stretch" : ""}`} aria-label={names.length > 1 ? "Special liveries" : "Special livery"}>
      <Photo reg={reg} alt={alt} />
      <div className="livery-band__text">
        <div>
          <p className="livery-band__mark">
            <Icon name="paint-roller" />
            {names.length > 1 ? "Special liveries" : "Special livery"}
          </p>
          <h2 className="livery-band__name">{names.join(" · ")}</h2>
          {about && <p className="livery-band__about">{about}</p>}
        </div>
        {facts.length > 0 && (
          <dl className="livery-band__facts">
            {facts.map((f) => (
              <div key={f.label}>
                <dt>{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <Credit reg={reg} />
      </div>
    </section>
  );
}

/** Flights in the livery out of all on the aircraft: "This flight", "Both flights", "All 3 flights", "1 of 2 flights". */
export function flownIn(n: number, total: number): string {
  if (total === 1) return "This flight";
  if (n === total) return total === 2 ? "Both flights" : `All ${total} flights`;
  return `${n} of ${plural(total, "flight")}`;
}

/** Days the aircraft was photographed in the livery: "9 Jun 2025", "3 times, first 9 Jun 2025". A narrow band breaks
 * the line after the count, never inside the date. */
export function photographedIn(days: (string | null)[]): string {
  const known = days.filter((d): d is string => !!d).sort();
  const first = known[0] ? dayMonthYear(known[0]).replace(/ /g, NBSP) : null;
  if (days.length === 1) return first ?? "Once, no date";
  return first ? `${plural(days.length, "time")}, first${NBSP}${first}` : plural(days.length, "time");
}

const NBSP = "\u00a0";
