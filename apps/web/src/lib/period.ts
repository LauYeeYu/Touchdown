// The period shared by Home, Flights, Spotting and Stats: a year or "all". Remembered per browser.

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { flightDay, todayIn, type Store } from "@touchdown/core";

const KEY = "td-year";
const listeners = new Set<() => void>();
let current: string | null = (() => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
})();

function setStored(v: string) {
  current = v;
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* storage unavailable: keep it for this session */
  }
  for (const l of listeners) l();
}

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

export function usePeriod(store: Store, version: number) {
  const stored = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const years = useMemo(() => yearsIn(store), [store, version]);
  const thisYear = todayIn().slice(0, 4);
  const valid = [...years, "all"];
  const fallback = years.includes(thisYear) ? thisYear : (years[years.length - 1] ?? "all");
  const year = stored && valid.includes(stored) ? stored : fallback;
  const setYear = useCallback((y: string) => setStored(y), []);
  return { year, setYear, years, thisYear };
}
