// Airports from OurAirports, with IANA time zones from airportsdata.

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
  notes: string[];
}

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
  let droppedNoTz = 0;
  const missingTz: string[] = [];
  for (const r of parseCsvRecords(ourAirportsCsv)) {
    const type = r.type ?? "";
    if (type === "closed") continue;
    const iata = code(r.iata_code, /^[A-Z]{3}$/);
    const major = type === "large_airport" || type === "medium_airport";
    if (!major && !iata) continue;

    const icao = code(r.icao_code, /^[A-Z0-9]{4}$/) ?? code(r.gps_code, /^[A-Z]{4}$/);
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
    if (!tz) {
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
        tz,
      },
    };
    const old = byId.get(id);
    if (!old || rank(candidate) < rank(old)) byId.set(id, candidate);
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
  return { rows, notes };
}
