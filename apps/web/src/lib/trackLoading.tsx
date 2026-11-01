// Recorded tracks load after the rest of the log (docs/12, "Sync algorithm"), and on a share link after its content.
// While they do, a map with flights still waiting for theirs says so in its corner and draws their great circles
// fainter, so a great circle about to be replaced does not read as the way the flight went.

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Icon } from "./icons.tsx";
import { nf } from "./format.ts";

/** Recorded tracks are being read now: the app's sync, or a share link's requests for them. */
export const TrackLoading = createContext(false);

/** Tracks are loading and this map has flights waiting for theirs. */
export function useTracksLoading(waiting: number): boolean {
  return useContext(TrackLoading) && waiting > 0;
}

/** Loading this long before the note shows, so a quick read never flashes it. */
const SHOW_AFTER_MS = 400;

/**
 * The note in a map's corner: "Loading tracks · 29 of 41" (this map's flights with a recorded track, and how many
 * are in), or "Loading the recorded track" on a flight's own map. It fades in after a moment and out when done.
 */
export function TrackLoadingNote({ waiting, total, one = false }: { waiting: number; total: number; one?: boolean }) {
  const on = useTracksLoading(waiting);
  const [shown, setShown] = useState(false);
  // The counts as they last were, so the note fades out with them instead of going blank.
  const last = useRef({ waiting, total });
  if (on) last.current = { waiting, total };
  useEffect(() => {
    if (!on) return setShown(false);
    const t = setTimeout(() => setShown(true), SHOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [on]);
  const { waiting: w, total: n } = last.current;
  return (
    <p className={`track-loading${shown ? " is-shown" : ""}`} role="status" aria-hidden={!shown}>
      <Icon name="loader-circle" />
      {one ? (
        <span>Loading the recorded track</span>
      ) : (
        <span>
          Loading tracks
          <span className="track-loading__count" aria-hidden="true">
            {" "}
            · {nf.format(n - w)} of {nf.format(n)}
          </span>
        </span>
      )}
    </p>
  );
}
