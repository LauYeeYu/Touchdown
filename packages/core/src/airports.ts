// Airports beyond the ones shipped with the app (docs/13, "Airports"): whether a log or a file needs the small
// airfields, which the app loads only then, and the pieces for adding an airport of the user's own (a position
// typed or pasted, and a time zone to start from).

import { haversineKm } from "./geo/index.ts";
import type { ParsedSource } from "./import/candidate.ts";
import type { Airport, RefIndex } from "./ref/index.ts";
import type { FlightValues, SightingValues } from "./schema/tables.ts";
import type { Store } from "./store.ts";

type AirportFields = Partial<Pick<FlightValues, "fromAirportId" | "fromRaw" | "toAirportId" | "toRaw" | "divertedToAirportId">> &
  Partial<Pick<SightingValues, "airportId" | "airportRaw">>;

/** An airport link that does not resolve: an id the index lacks, or a code typed with no id. */
function unresolved(ref: RefIndex, id: string | null | undefined, raw: string | null | undefined): boolean {
  return id ? !ref.airport(id) : !!raw?.trim() && !ref.airportByCode(raw);
}

/** Whether a flight's or a sighting's values name an airport the index does not have. */
export function needsMoreAirports(ref: RefIndex, v: AirportFields): boolean {
  return (
    unresolved(ref, v.fromAirportId, v.fromRaw) ||
    unresolved(ref, v.toAirportId, v.toRaw) ||
    unresolved(ref, v.divertedToAirportId, null) ||
    unresolved(ref, v.airportId, v.airportRaw)
  );
}

/**
 * Whether the log names an airport the index does not have: a record linked to a small airfield (which the app loads
 * only when needed) or with a code that is in none of the tables loaded yet.
 */
export function logNeedsMoreAirports(store: Store, ref: RefIndex): boolean {
  return store.all("flights").some((f) => needsMoreAirports(ref, f)) || store.all("sightings").some((s) => needsMoreAirports(ref, s));
}

/** Whether a file read for import names an airport the index does not have. */
export function sourceNeedsMoreAirports(source: ParsedSource, ref: RefIndex): boolean {
  return source.candidates.some((c) => needsMoreAirports(ref, c.values));
}

/** The airport nearest a position, among those the index has. */
export function nearestAirport(ref: RefIndex, lat: number, lon: number): Airport | null {
  let best: Airport | null = null;
  let bestKm = Infinity;
  for (const a of ref.airports.values()) {
    const km = haversineKm({ lat, lon }, a);
    if (km < bestKm) [best, bestKm] = [a, km];
  }
  return best;
}

interface Part {
  deg: number;
  min: number;
  sec: number;
  letter: string | null;
}

/**
 * A position as a map gives it or a person writes it: decimal degrees ("51.5008, -0.7744"), with hemisphere letters
 * before or after ("51.5008° N, 0.7744° W", "N51.5008 W0.7744") or degrees, minutes and seconds
 * (`51°30'03"N 0°46'28"W`). Latitude first unless the letters say otherwise. Null when it is not one.
 */
export function parsePosition(text: string): { lat: number; lon: number } | null {
  const s = text
    .toUpperCase()
    .replace(/[′’]/g, "'")
    .replace(/[″”]|''/g, '"')
    .replace(/,/g, " ");
  if (/[^NSEW0-9.\-°'"\s]/.test(s)) return null;
  const tokens = s.match(/[NSEW]|-?\d+(?:\.\d+)?\s*[°'"]?/g) ?? [];
  const parts: Part[] = [];
  let cur: Part | null = null;
  let pending: string | null = null;
  for (const raw of tokens) {
    const tok = raw.replace(/\s+/g, "");
    if (/^[NSEW]$/.test(tok)) {
      if (cur && !cur.letter) {
        cur.letter = tok;
        parts.push(cur);
        cur = null;
      } else if (pending) return null;
      else pending = tok;
      continue;
    }
    const unit = /[°'"]$/.test(tok) ? tok.slice(-1) : "";
    const n = Number(unit ? tok.slice(0, -1) : tok);
    if (unit === "'" || unit === '"') {
      if (!cur || n < 0 || n >= 60 || (unit === "'" ? cur.min || cur.sec : cur.sec)) return null;
      if (unit === "'") cur.min = n;
      else cur.sec = n;
      continue;
    }
    if (cur) parts.push(cur);
    cur = { deg: n, min: 0, sec: 0, letter: pending };
    pending = null;
  }
  if (cur) parts.push(cur);
  if (pending || parts.length !== 2) return null;
  const value = (p: Part) => {
    const v = Math.abs(p.deg) + p.min / 60 + p.sec / 3600;
    return (p.deg < 0 || Object.is(p.deg, -0) || p.letter === "S" || p.letter === "W" ? -v : v) || 0;
  };
  const axis = (p: Part) => (p.letter === "N" || p.letter === "S" ? "lat" : p.letter === "E" || p.letter === "W" ? "lon" : null);
  const [a, b] = parts as [Part, Part];
  // A letter decides its value's axis, and the other's.
  const first = axis(a) ?? (axis(b) === "lat" ? "lon" : "lat");
  const second = axis(b) ?? (first === "lat" ? "lon" : "lat");
  if (first === second || (a.letter && a.deg < 0) || (b.letter && b.deg < 0)) return null;
  const lat = first === "lat" ? value(a) : value(b);
  const lon = first === "lat" ? value(b) : value(a);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5 };
}
