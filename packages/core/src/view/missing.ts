// The flights without a recorded track, as a short list to send to someone who can find their tracks (docs/23,
// "Helping each other"): when, which flight, the route, the aircraft and the times, nothing private. The same in the
// web app (Flights) and the CLI (`export missing-tracks`).

import { csvCell } from "../backup.ts";
import { arrivalAirportId, flightDay } from "../derive.ts";
import type { RefIndex } from "../ref/index.ts";
import type { Store } from "../store.ts";
import { instant, toUtcIso } from "../time/index.ts";
import { textCode } from "./codes.ts";

export interface MissingTrack {
  id: string;
  date: string | null;
  flight: string | null;
  from: string;
  to: string;
  registration: string | null;
  type: string | null;
  /** UTC, "YYYY-MM-DD HH:MM". */
  takeoff: string | null;
  landing: string | null;
}

const utc = (t: string | null) => {
  const ms = instant(t);
  return ms === null ? null : toUtcIso(ms).slice(0, 16).replace("T", " ");
};

/** The flights with no recorded track, oldest first. */
export function flightsWithoutTrack(store: Store, ref: RefIndex): MissingTrack[] {
  const tracked = new Set(store.all("tracks").map((t) => t.flightId));
  return store
    .all("flights")
    .filter((f) => !tracked.has(f.id))
    .map((f) => ({
      id: f.id,
      date: flightDay(f),
      flight: f.flightNumber,
      from: textCode(ref.airport(f.fromAirportId), f.fromRaw),
      to: textCode(ref.airport(arrivalAirportId(f)), f.toRaw),
      registration: f.registration,
      type: f.typeCode,
      takeoff: utc(f.takeoffAt),
      landing: utc(f.landingAt),
    }))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || (a.takeoff ?? "").localeCompare(b.takeoff ?? ""));
}

/** The list as CSV, one flight a row. */
export function missingTracksCsv(store: Store, ref: RefIndex): string {
  const head = ["Date", "Flight", "From", "To", "Registration", "Type", "Takeoff (UTC)", "Landing (UTC)"];
  const rows = flightsWithoutTrack(store, ref).map((m) => [m.date, m.flight, m.from, m.to, m.registration, m.type, m.takeoff, m.landing].map(csvCell).join(","));
  return [head.join(","), ...rows].join("\r\n") + "\r\n";
}
