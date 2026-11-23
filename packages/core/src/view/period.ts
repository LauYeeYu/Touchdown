// The period the views show: a year ("2025") or "all".

import { flightDay } from "../derive.ts";
import type { Store } from "../store.ts";

/**
 * The years with a flight, planned ones included, or a sighting, oldest first, and `thisYear` when given: the period
 * control always offers the current year (docs/31, "Period control").
 */
export function yearsIn(store: Store, thisYear?: string): string[] {
  const set = new Set<string>(thisYear ? [thisYear] : []);
  for (const f of store.all("flights")) {
    const d = flightDay(f);
    if (d) set.add(d.slice(0, 4));
  }
  for (const s of store.all("sightings")) if (s.seenOn) set.add(s.seenOn.slice(0, 4));
  return [...set].sort();
}

export function inPeriod(ymd: string | null | undefined, year: string): boolean {
  if (year === "all") return true;
  return !!ymd && ymd.startsWith(year);
}
