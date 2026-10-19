// Builds the reference tables in packages/refdata/data from open sources (docs/13-reference-data.md).
//
//   npx tsx packages/refdata/scripts/build.ts            reuse files in packages/refdata/.cache
//   npx tsx packages/refdata/scripts/build.ts --refresh  download every source again
//
// Output: one RefTableFile per table, rows sorted, one row per line.

import type { Airport, AircraftType, Family, ModelPattern, Operator, RegistrationPrefix } from "../../core/src/ref/types.ts";
import { families } from "../src/curated/families.ts";
import { modelPatterns } from "../src/curated/model-patterns.ts";
import { registrationPrefixes } from "../src/curated/registration-prefixes.ts";
import { buildAircraftTypes } from "./aircraft-types.ts";
import { buildAirports } from "./airports.ts";
import { cached, compare, unzip, writeTable } from "./lib.ts";
import { WIKIDATA_QUERY, buildOperators } from "./operators.ts";

const URLS = {
  ourAirports: "https://davidmegginson.github.io/ourairports-data/airports.csv",
  airportsData: "https://raw.githubusercontent.com/mborsetti/airportsdata/main/airportsdata/airports.csv",
  mictronics: "https://raw.githubusercontent.com/Mictronics/aircraft-database/main/indexedDB_old.zip",
  vrs: "https://raw.githubusercontent.com/vradarserver/standing-data/main",
  wikidata: "https://query.wikidata.org/sparql",
};

const ATTRIBUTION = {
  ourAirports: "OurAirports (ourairports.com), public domain",
  airportsData: "airportsdata by Mike Borsetti (github.com/mborsetti/airportsdata), MIT licence",
  mictronics: "Mictronics aircraft database (github.com/Mictronics/aircraft-database), Open Data Commons Attribution License (ODC-By)",
  vrs: "Virtual Radar Server standing data (github.com/vradarserver/standing-data), CC0",
  wikidata: "Wikidata (wikidata.org), CC0",
  touchdown: "Touchdown curated table",
};

const VRS_MODEL_TYPE_FILES = ["-", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

const columns = {
  airports: ["id", "icao", "iata", "name", "city", "country", "lat", "lon", "elevationFt", "tz"],
  operators: ["id", "icao", "iata", "name", "callsign", "country", "kind", "validFrom", "validTo"],
  aircraftTypes: ["designator", "manufacturer", "name", "familyId", "engineType", "engineCount", "wtc"],
  families: ["id", "name", "manufacturer"],
  modelPatterns: ["designator", "pattern", "example"],
  registrationPrefixes: ["prefix", "country", "pattern"],
} as const satisfies {
  airports: readonly (keyof Airport)[];
  operators: readonly (keyof Operator)[];
  aircraftTypes: readonly (keyof AircraftType)[];
  families: readonly (keyof Family)[];
  modelPatterns: readonly (keyof ModelPattern)[];
  registrationPrefixes: readonly (keyof RegistrationPrefix)[];
};

async function text(fileName: string, url: string, refresh: boolean, init?: RequestInit): Promise<string> {
  return (await cached(fileName, url, refresh, init)).toString("utf8");
}

async function wikidataAirlines(refresh: boolean): Promise<string | null> {
  const url = `${URLS.wikidata}?query=${encodeURIComponent(WIKIDATA_QUERY)}`;
  try {
    return await text("wikidata-airlines.csv", url, refresh, { headers: { Accept: "text/csv" } });
  } catch (err) {
    console.warn(`Wikidata query failed (${(err as Error).message}); falling back to VRS airline codes`);
    try {
      return await text("wikidata-airlines.csv", url, false);
    } catch {
      return null;
    }
  }
}

async function main() {
  const refresh = process.argv.includes("--refresh");
  const version = new Date().toISOString().slice(0, 10); // build date, UTC
  const notes: string[] = [];

  const [ourAirports, airportsData, vrsAirlines, mictronicsZip, wikidata, ...vrsModelTypes] = await Promise.all([
    text("ourairports-airports.csv", URLS.ourAirports, refresh),
    text("airportsdata-airports.csv", URLS.airportsData, refresh),
    text("vrs-airlines.csv", `${URLS.vrs}/airlines/schema-01/airlines.csv`, refresh),
    cached("mictronics-indexedDB_old.zip", URLS.mictronics, refresh),
    wikidataAirlines(refresh),
    ...VRS_MODEL_TYPE_FILES.map((f) => text(`vrs-model-type-${f}.csv`, `${URLS.vrs}/model-type/schema-01/${f}.csv`, refresh)),
  ]);
  const mictronics = unzip(mictronicsZip, ["operators.json", "types.json"]);

  const airports = buildAirports(ourAirports, airportsData);
  notes.push(...airports.notes);
  writeTable("airports", version, [ATTRIBUTION.ourAirports, ATTRIBUTION.airportsData, ATTRIBUTION.touchdown], columns.airports, airports.rows);

  const operators = buildOperators(mictronics.get("operators.json")!.toString("utf8"), wikidata, vrsAirlines);
  notes.push(...operators.notes);
  const operatorSources = [ATTRIBUTION.mictronics, ATTRIBUTION.vrs, ...(wikidata ? [ATTRIBUTION.wikidata] : []), ATTRIBUTION.touchdown];
  writeTable("operators", version, operatorSources, columns.operators, operators.rows);

  const types = buildAircraftTypes(vrsModelTypes, mictronics.get("types.json")!.toString("utf8"));
  notes.push(...types.notes);
  writeTable("aircraft_types", version, [ATTRIBUTION.vrs, ATTRIBUTION.mictronics, ATTRIBUTION.touchdown], columns.aircraftTypes, types.rows);

  const familyRows = [...families].sort((a, b) => compare(a.id, b.id));
  writeTable("families", version, [ATTRIBUTION.touchdown], columns.families, familyRows);

  const patternRows = [...modelPatterns].sort((a, b) => compare(a.designator, b.designator) || compare(a.pattern, b.pattern));
  writeTable("model_patterns", version, [ATTRIBUTION.touchdown], columns.modelPatterns, patternRows);

  const prefixRows = [...registrationPrefixes].sort((a, b) => compare(a.prefix, b.prefix));
  writeTable("registration_prefixes", version, [ATTRIBUTION.touchdown], columns.registrationPrefixes, prefixRows);

  notes.push(`families: ${familyRows.length} rows; model_patterns: ${patternRows.length} rows; registration_prefixes: ${prefixRows.length} rows`);
  console.log(notes.join("\n"));
}

await main();
