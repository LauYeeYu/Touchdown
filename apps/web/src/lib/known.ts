// What the log already knows about a registration: shown while a sighting is typed (docs/31-ui.md).

import { flightDay, nearestLivery, registrationMatchForm, todayIn, type Flight, type Sighting, type Store, type WornLivery } from "@touchdown/core";

export interface Known {
  typeCode: string | null;
  model: string | null;
  operatorRaw: string | null;
  operatorId: string | null;
  sightings: Sighting[];
  flights: Flight[];
  /** The special livery recorded nearest the date. Never filled in: the user is asked (docs/21, "Special livery"). */
  specialLivery: WornLivery | null;
}

/** `date` is the sighting's day; `except` is the sighting being edited, left out. */
export function knownFor(store: Store, registration: string, date?: string | null, except?: string): Known | null {
  const key = registrationMatchForm(registration);
  if (key.length < 3) return null;
  const sightings = store.all("sightings").filter((s) => s.registration && registrationMatchForm(s.registration) === key).sort((a, b) => (b.seenOn ?? "").localeCompare(a.seenOn ?? ""));
  const flights = store.all("flights").filter((f) => f.registration && registrationMatchForm(f.registration) === key).sort((a, b) => (flightDay(b) ?? "").localeCompare(flightDay(a) ?? ""));
  if (!sightings.length && !flights.length) return null;
  const latest = sightings[0];
  const airframe = store.get("airframes", latest?.airframeId ?? flights[0]?.airframeId);
  return {
    typeCode: airframe?.typeCode ?? latest?.typeCode ?? flights[0]?.typeCode ?? null,
    model: airframe?.model ?? latest?.model ?? flights[0]?.model ?? null,
    operatorRaw: latest?.operatorRaw ?? null,
    operatorId: latest?.operatorId ?? flights[0]?.operatingAirlineId ?? flights[0]?.airlineId ?? null,
    sightings,
    flights,
    specialLivery: nearestLivery(
      [...sightings.filter((s) => s.id !== except).map((s) => ({ date: s.seenOn, specialLivery: s.specialLivery })), ...flights.map((f) => ({ date: flightDay(f), specialLivery: f.specialLivery }))],
      date || todayIn(),
    ),
  };
}

const LAST = "td-last-spot";

export function lastSpot(): { date: string; airport: string } | null {
  try {
    return JSON.parse(localStorage.getItem(LAST) ?? "null");
  } catch {
    return null;
  }
}

export function rememberSpot(date: string, airport: string) {
  try {
    localStorage.setItem(LAST, JSON.stringify({ date, airport }));
  } catch {
    /* storage unavailable */
  }
}
