// The Flights page's search, shared with `touchdown flights --search`: text in a flight's number, airports, cities,
// registration, airline or type, or a route between two airports. "SHA-PEK", "Shanghai - Beijing" and "SHA PEK" find
// the route either way, "SHA > PEK" and "SHA to PEK" only that way.

import type { RefIndex } from "../ref/index.ts";
import { airlineLabel } from "./format.ts";
import type { FlightView } from "./views.ts";

/** Lower case, no accents, no spaces: "São Paulo" and "sao paulo" are the same text. */
const squash = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, "");

/** Whether an airport, by id or as typed when it is not known, is the one a side of a route names. */
type Side = (id: string | null, raw: string | null) => boolean;

interface Route {
  from: string;
  to: string;
  oneWay: boolean;
}

function routeOf(q: string, ref: RefIndex): Route | null {
  const one = /^(.+?)\s*(?:->|=>|>|→|\sto\s)\s*(.+)$/i.exec(q);
  if (one) return { from: one[1]!, to: one[2]!, oneWay: true };
  const both = /^(.+?)\s*[-–—⇄↔]\s*(.+)$/.exec(q);
  if (both) return { from: both[1]!, to: both[2]!, oneWay: false };
  // Two codes with only a space between.
  const codes = /^(\S{3,4})\s+(\S{3,4})$/.exec(q);
  if (codes && ref.airportByCode(codes[1]) && ref.airportByCode(codes[2])) return { from: codes[1]!, to: codes[2]!, oneWay: false };
  return null;
}

/**
 * One side of a route. An airport's code names only that airport, so "SHA" is Hongqiao and not every Shanghai
 * airport. Other text is the start of a code or a city, or part of a city or airport name: "shang" finds both of
 * Shanghai's.
 */
function airportTerm(term: string, ref: RefIndex): Side {
  const t = squash(term);
  const isCode = !!ref.airportByCode(t);
  const seen = new Map<string, boolean>();
  const known = (id: string) => {
    const a = ref.airport(id);
    if (!a) return false;
    const codes = [a.iata, a.icao].filter((c): c is string => !!c).map(squash);
    if (isCode) return codes.includes(t);
    const city = squash(a.city ?? "");
    return codes.some((c) => c.startsWith(t)) || city.startsWith(t) || (t.length >= 3 && (city.includes(t) || squash(a.name).includes(t)));
  };
  return (id, raw) => {
    if (id) {
      if (!seen.has(id)) seen.set(id, known(id));
      if (seen.get(id)) return true;
    }
    return !!raw && squash(raw) === t;
  };
}

/** A test for the flights that match the search text; every flight matches empty text. */
export function flightSearch(q: string, ref: RefIndex): (v: FlightView) => boolean {
  const needle = squash(q);
  if (!needle) return () => true;
  const route = routeOf(q.trim(), ref);
  const from = route && airportTerm(route.from, ref);
  const to = route && airportTerm(route.to, ref);
  return (v) => {
    const f = v.f;
    if (from && to) {
      const dep = (side: Side) => side(f.fromAirportId, f.fromRaw);
      // A diverted flight is on the route it was flown and on the one it was booked.
      const arr = (side: Side) => side(f.toAirportId, f.toRaw) || (!!f.divertedToAirportId && side(f.divertedToAirportId, null));
      if ((dep(from) && arr(to)) || (!route!.oneWay && dep(to) && arr(from))) return true;
    }
    const a = ref.airport(f.fromAirportId);
    const b = ref.airport(f.toAirportId);
    return squash([f.flightNumber, v.fromCode, v.toCode, a?.icao, b?.icao, a?.city, b?.city, f.registration, airlineLabel(f.airlineId, ref), f.typeCode].join("|")).includes(needle);
  };
}
