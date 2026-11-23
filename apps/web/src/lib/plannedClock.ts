// A planned flight changes status on its own when its time passes, and its reminder comes back at the time the user
// chose, though nothing is written (docs/10, "A flight's status"). This tells the app's data, or a share link's, at
// those moments, so its pages work out again what they show, as after a change to the log.

import { nextPlannedChange, type RefIndex, type Store } from "@touchdown/core";

/** setTimeout's longest wait, about 24.8 days: a later moment is waited for in steps. */
const LONGEST = 2 ** 31 - 1;

/** Calls `notify` at each moment a planned flight's status or reminder changes. Returns what stops it. */
export function watchPlanned(store: Store, ref: RefIndex, notify: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    const next = nextPlannedChange(store.all("flights"), ref);
    if (next === null) return;
    // A little after the moment, so the status read then is the new one.
    timer = setTimeout(() => {
      if (Date.now() >= next) notify();
      arm();
    }, Math.min(LONGEST, Math.max(0, next - Date.now()) + 50));
  };
  arm();
  const stop = store.subscribe(arm);
  return () => {
    clearTimeout(timer);
    stop();
  };
}
