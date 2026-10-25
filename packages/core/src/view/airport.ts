// One airport in the user's log (docs/31-ui.md, "Airport page"), for the web app's airport page and
// `touchdown airport`: the flights that left or landed there, the transits, the aircraft photographed there.

import { arrivalAirportId } from "../derive.ts";
import type { RefIndex } from "../ref/index.ts";
import type { Flight, Sighting } from "../schema/tables.ts";
import { airportVisits, type AirportVisits } from "../stats/index.ts";
import type { Store } from "../store.ts";
import type { CodeStyle } from "./codes.ts";
import { inPeriod } from "./period.ts";
import { sortedFlights, type FlightView } from "./views.ts";

/** An aircraft photographed at the airport, with the registration and operator as last seen there. */
export interface Spotted {
  key: string;
  airframeId: string | null;
  sightingId: string;
  registration: string;
  operatorId: string | null;
  operatorRaw: string | null;
  typeCode: string | null;
  days: Set<string>;
  count: number;
  last: string | null;
}

export interface AirportSummary {
  /** The period's flights that left from or landed at the airport, oldest first. */
  here: FlightView[];
  visits: AirportVisits;
  transitIds: Set<string>;
  sightings: Sighting[];
  /** Aircraft photographed there, last seen first. */
  spotted: Spotted[];
  /** Days with a sighting there. */
  days: Set<string>;
  /** Flights per airframe over the whole log, for "you flew on it". */
  flownOn: Map<string, number>;
  /** The airport flown to and from most often from here, with the number of flights. */
  topOther: [string, number] | null;
  firstDay: string | null;
  everFlown: boolean;
  everSpotted: boolean;
}

function newSpotted(key: string, s: Sighting): Spotted {
  return {
    key,
    airframeId: s.airframeId,
    sightingId: s.id,
    registration: s.registration ?? s.registrationRaw ?? "",
    operatorId: s.operatorId,
    operatorRaw: s.operatorRaw,
    typeCode: s.typeCode,
    days: new Set(),
    count: 0,
    last: null,
  };
}

export function airportSummary(store: Store, ref: RefIndex, id: string, year: string, style: CodeStyle = "iata"): AirportSummary {
  const all = sortedFlights(store, ref, style);
  const touches = (f: Flight) => f.fromAirportId === id || arrivalAirportId(f) === id;
  const everFlown = all.some((v) => touches(v.f));
  const allSightings = store.all("sightings").filter((s) => s.airportId === id);
  const inYear = all.filter((v) => inPeriod(v.day, year));
  const here = inYear.filter((v) => touches(v.f));
  // A transit needs the user's very next flight, so the visits are worked out over all the period's flights.
  const visits = airportVisits(
    inYear.map((v) => v.f),
    id,
  );
  const transitIds = new Set(visits.transits.flatMap((t) => [t.arrive.id, t.depart.id]));
  const sightings = allSightings.filter((s) => inPeriod(s.seenOn, year));
  const flownOn = new Map<string, number>();
  for (const f of store.all("flights")) if (f.airframeId) flownOn.set(f.airframeId, (flownOn.get(f.airframeId) ?? 0) + 1);
  const byAirframe = new Map<string, Spotted>();
  for (const s of sightings) {
    const key = s.airframeId ?? `s:${s.id}`;
    const e = byAirframe.get(key) ?? newSpotted(key, s);
    e.count++;
    if (s.seenOn) {
      e.days.add(s.seenOn);
      if (!e.last || s.seenOn > e.last) e.last = s.seenOn;
    }
    // The registration and operator as last seen here.
    if (s.seenOn && s.seenOn === e.last) {
      e.registration = s.registration ?? s.registrationRaw ?? e.registration;
      e.operatorId = s.operatorId ?? e.operatorId;
    }
    byAirframe.set(key, e);
  }
  const spotted = [...byAirframe.values()].sort((a, b) => (b.last ?? "").localeCompare(a.last ?? "") || a.registration.localeCompare(b.registration));
  const days = new Set(sightings.map((s) => s.seenOn).filter((d): d is string => !!d));
  // Where the user flew to and from here, most often first.
  const others = new Map<string, number>();
  for (const v of here) {
    const other = v.f.fromAirportId === id ? arrivalAirportId(v.f) : v.f.fromAirportId;
    if (other && other !== id) others.set(other, (others.get(other) ?? 0) + 1);
  }
  const topOther = [...others].sort((a, b) => b[1] - a[1])[0] ?? null;
  const firstDay = [...here.map((v) => v.day), ...sightings.map((s) => s.seenOn)].filter((d): d is string => !!d).sort()[0] ?? null;
  return { here, visits, transitIds, sightings, spotted, days, flownOn, topOther, firstDay, everFlown, everSpotted: allSightings.length > 0 };
}
