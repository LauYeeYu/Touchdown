// The period the views show: a year ("2025") or "all".

import { flightDay } from "../derive.ts";
import type { Store } from "../store.ts";

/** The years with a flight or a sighting, oldest first. */
export function yearsIn(store: Store): string[] {
  const set = new Set<string>();
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
