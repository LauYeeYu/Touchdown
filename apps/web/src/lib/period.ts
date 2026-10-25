// The period shared by Home, Flights, Spotting and Stats: a year or "all". Remembered per browser.

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { todayIn, type Store } from "@touchdown/core";
import { yearsIn } from "@touchdown/core/view";

export { inPeriod, yearsIn } from "@touchdown/core/view";

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
