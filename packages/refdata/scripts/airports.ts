// Airports from OurAirports, with IANA time zones from airportsdata. Two tables: the airports shipped with the app
// (large and medium airports, and any with an IATA code), and the small airfields with an ICAO code, which the app
// loads only when a record needs one (docs/13, "Airports").

import type { Airport } from "../../core/src/ref/types.ts";
import { airportTzFixes, singleZoneCountryTz } from "../src/curated/fixes.ts";
import { compare, distanceKm, parseCsvRecords } from "./lib.ts";

// A time zone match further away than this is treated as a different airport sharing a code.
const MAX_TZ_MATCH_KM = 100;

const TYPE_RANK: Record<string, number> = { large_airport: 0, medium_airport: 1, small_airport: 2, seaplane_base: 3, heliport: 4, balloonport: 5 };

interface TzSource {
  lat: number;
  lon: number;
  tz: string;
}

interface Candidate {
  airport: Airport;
  type: string;
  scheduled: boolean;
}

export interface AirportBuild {
  rows: Airport[];
  /** Small airfields, seaplane bases, heliports and balloon ports with an ICAO code and no IATA code. */
  airfields: Airport[];
  notes: string[];
}

// An airfield the sources give no time zone takes the zone of the nearest airport in its country that has one, when
// that airport is this close. Checked against airfields whose zone is known, it gives the right offsets for 98% of them.
const MAX_NEAREST_ZONE_KM = 100;

function code(value: string | undefined, re: RegExp): string | null {
  const v = (value ?? "").trim().toUpperCase();
  return re.test(v) ? v : null;
}

function rank(c: Candidate): number {
  return (TYPE_RANK[c.type] ?? 9) * 2 + (c.scheduled ? 0 : 1);
}

export function buildAirports(ourAirportsCsv: string, airportsDataCsv: string): AirportBuild {
  const notes: string[] = [];

  const tzByIcao = new Map<string, TzSource>();
  const tzByIata = new Map<string, TzSource>();
  const tzByLid = new Map<string, TzSource>(); // FAA location identifiers (US)
  for (const r of parseCsvRecords(airportsDataCsv)) {
    if (!r.tz) continue;
    const src = { lat: Number(r.lat), lon: Number(r.lon), tz: r.tz };
    if (r.icao) tzByIcao.set(r.icao.toUpperCase(), src);
    if (r.iata && !tzByIata.has(r.iata.toUpperCase())) tzByIata.set(r.iata.toUpperCase(), src);
    if (r.lid) tzByLid.set(r.lid.toUpperCase(), src);
  }

  const byId = new Map<string, Candidate>();
  const fields = new Map<string, Candidate>();
  const zoneless: Candidate[] = [];
  let droppedNoTz = 0;
  const missingTz: string[] = [];
  for (const r of parseCsvRecords(ourAirportsCsv)) {
    const type = r.type ?? "";
    if (type === "closed") continue;
    const iata = code(r.iata_code, /^[A-Z]{3}$/);
    const major = type === "large_airport" || type === "medium_airport";
    const icao = code(r.icao_code, /^[A-Z0-9]{4}$/) ?? code(r.gps_code, /^[A-Z]{4}$/);
    const airfield = !major && !iata;
    if (airfield && !icao) continue;

    const ident = (r.ident ?? "").trim().toUpperCase();
    const id = `ap_${(icao ?? ident).toLowerCase()}`;
    const lat = Number(r.latitude_deg);
    const lon = Number(r.longitude_deg);

    const near = (s: TzSource | undefined) => (s && distanceKm(lat, lon, s.lat, s.lon) <= MAX_TZ_MATCH_KM ? s.tz : null);
    const tz =
      airportTzFixes[id] ??
      (icao ? near(tzByIcao.get(icao)) : null) ??
      near(tzByIcao.get(ident)) ??
      (iata ? near(tzByIata.get(iata)) : null) ??
      (r.local_code ? near(tzByLid.get(r.local_code.toUpperCase())) : null) ??
      singleZoneCountryTz[r.iso_country ?? ""];
    if (!tz && !airfield) {
      if (major) missingTz.push(`${id} (${type}, ${r.iso_country})`);
      else droppedNoTz++;
      continue;
    }

    const elevation = r.elevation_ft ? Math.round(Number(r.elevation_ft)) : null;
    const candidate: Candidate = {
      type,
      scheduled: r.scheduled_service === "yes",
      airport: {
        id,
        icao,
        iata,
        name: (r.name ?? "").trim(),
        city: (r.municipality ?? "").trim() || null,
        country: (r.iso_country ?? "").trim(),
        lat: Math.round(lat * 1e5) / 1e5,
        lon: Math.round(lon * 1e5) / 1e5,
        elevationFt: Number.isFinite(elevation) ? elevation : null,
        tz: tz ?? "",
      },
    };
    if (airfield && !tz) {
      zoneless.push(candidate);
      continue;
    }
    const into = airfield ? fields : byId;
    const old = into.get(id);
    if (!old || rank(candidate) < rank(old)) into.set(id, candidate);
  }

  // An IATA code should lead to one airport. When OurAirports gives the same code to several open
  // airports, keep it on the busiest kind (large, then medium, then scheduled service).
  const byIata = new Map<string, Candidate[]>();
  for (const c of byId.values()) if (c.airport.iata) byIata.set(c.airport.iata, [...(byIata.get(c.airport.iata) ?? []), c]);
  let iataCleared = 0;
  for (const list of byIata.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => rank(a) - rank(b) || compare(a.airport.id, b.airport.id));
    for (const c of list.slice(1)) {
      c.airport.iata = null;
      iataCleared++;
    }
  }

  const rows = [...byId.values()].map((c) => c.airport).sort((a, b) => compare(a.id, b.id));
  notes.push(`airports: ${rows.length} rows; ${droppedNoTz} small airports dropped for lack of a time zone; ${iataCleared} duplicate IATA codes cleared`);
  if (missingTz.length) notes.push(`airports: large/medium airports without a time zone (add to airportTzFixes): ${missingTz.join(", ")}`);

  // Airfields: none with an id or an ICAO code the airports have. One without a zone takes its nearest neighbour's.
  const taken = new Set(rows.flatMap((a) => [a.id, a.icao]));
  const zoned = [...rows, ...[...fields.values()].map((c) => c.airport)];
  const byCountry = new Map<string, Airport[]>();
  for (const a of zoned) byCountry.set(a.country, [...(byCountry.get(a.country) ?? []), a]);
  let nearestZone = 0;
  let noZone = 0;
  for (const c of zoneless) {
    const a = c.airport;
    let best: Airport | null = null;
    let bestKm = MAX_NEAREST_ZONE_KM;
    for (const b of byCountry.get(a.country) ?? []) {
      const km = distanceKm(a.lat, a.lon, b.lat, b.lon);
      if (km <= bestKm) [best, bestKm] = [b, km];
    }
    if (!best) {
      noZone++;
      continue;
    }
    nearestZone++;
    const candidate = { ...c, airport: { ...a, tz: best.tz } };
    const old = fields.get(a.id);
    if (!old || rank(candidate) < rank(old)) fields.set(a.id, candidate);
  }
  const airfields = [...fields.values()]
    .map((c) => c.airport)
    .filter((a) => !taken.has(a.id) && !taken.has(a.icao))
    .sort((a, b) => compare(a.id, b.id));
  notes.push(`airfields: ${airfields.length} rows; ${nearestZone} with the time zone of the nearest airport; ${noZone} dropped for lack of a time zone`);
  return { rows, airfields, notes };
}
