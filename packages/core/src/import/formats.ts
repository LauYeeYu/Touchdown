// The my.flightradar24.com CSV export (docs/21-import-export.md), the one source with a fixed reader: its layout is
// the same for everyone. Every other spreadsheet is read through a column mapping (mapping.ts).

import type { RefIndex } from "../ref/index.ts";
import type { FlightValues } from "../schema/tables.ts";
import { normaliseFlight } from "../normalise/record.ts";
import { parseDuration, parseLooseDate } from "../time/index.ts";
import { buildFlightTimes } from "./times.ts";
import type { SheetData } from "./read.ts";
import { fieldsOf, guessMapping, mappingProblem, readMapped, type ColumnField, type RowKind } from "./mapping.ts";
import { rawRecord, type FlightCandidate, type ImportIssue, type ParsedSource } from "./candidate.ts";

const FR24_HEADER = ["Date", "Flight number", "From", "To", "Dep time", "Arr time", "Duration", "Airline", "Aircraft", "Registration"];

/** Is this the my.flightradar24.com export? */
export const isFr24Export = (header: string[]) => FR24_HEADER.every((c) => header.includes(c));

/**
 * Reads a sheet: the Flightradar24 export with its own reader, anything else with `mapping`, or with the guessed
 * one when none is given (columns the guess is unsure of are not used). null when the columns do not hold
 * enough to read rows (no registration for sightings; no date, or no flight number or airports, for flights).
 */
export function parseSource(sheet: SheetData, fileName: string, ref: RefIndex, mapping?: { kind: RowKind; fields: ColumnField[] }): ParsedSource | null {
  if (isFr24Export(sheet.header)) {
    const candidates = sheet.rows.map((row, i) => parseFr24Row(rawRecord(sheet.header, row), sheet.firstRow + i, ref));
    return { format: "fr24_csv", fileName, candidates, rowsRead: sheet.rows.length };
  }
  const m = mapping ?? fieldsOf(guessMapping(sheet, ref));
  return mappingProblem(m) ? null : readMapped(sheet, m, fileName, ref);
}

// ---------- my.flightradar24.com ----------

/** "Amsterdam / Schiphol (AMS/EHAM)" → { iata: "AMS", icao: "EHAM" }; also "Delta Air Lines (DL/DAL)". */
export function codesInParens(s: string | null | undefined): { first: string | null; second: string | null } {
  if (!s) return { first: null, second: null };
  const m = /\(([^()]*)\)\s*$/.exec(s);
  if (!m) return { first: null, second: null };
  const [a, b] = m[1]!.split("/").map((x) => x.trim() || null);
  return { first: a ?? null, second: b ?? null };
}

const FR24_SEAT: Record<string, FlightValues["seatPosition"]> = { "1": "window", "2": "middle", "3": "aisle" };
const FR24_CLASS: Record<string, FlightValues["cabinClass"]> = { "1": "economy", "2": "business", "3": "first", "4": "premium_economy", "5": "private" };
const FR24_REASON: Record<string, FlightValues["reason"]> = { "1": "leisure", "2": "business", "3": "crew", "4": "other" };

function parseFr24Row(raw: Record<string, string | null>, sourceRow: number, ref: RefIndex): FlightCandidate {
  const issues: ImportIssue[] = [];
  const scheduledDate = parseLooseDate(raw["Date"] ?? "");
  const from = codesInParens(raw["From"]);
  const to = codesInParens(raw["To"]);
  const airline = codesInParens(raw["Airline"]);
  const aircraft = codesInParens(raw["Aircraft"]);
  // Resolve by ICAO first (unique), then IATA; keep the code as written.
  const fromAirport = ref.airportByCode(from.second) ?? ref.airportByCode(from.first);
  const toAirport = ref.airportByCode(to.second) ?? ref.airportByCode(to.first);
  const op = ref.operatorByCode(airline.second, scheduledDate) ?? ref.operatorByCode(airline.first, scheduledDate);
  let values: Partial<FlightValues> = normaliseFlight(
    {
      scheduledDate,
      flightNumber: raw["Flight number"],
      airlineRaw: airline.first ?? airline.second,
      airlineId: op?.id ?? null,
      fromRaw: from.first ?? from.second,
      fromAirportId: fromAirport?.id ?? null,
      toRaw: to.first ?? to.second,
      toAirportId: toAirport?.id ?? null,
      registrationRaw: raw["Registration"],
      typeCodeRaw: aircraft.first,
      seat: raw["Seat number"],
      seatPosition: FR24_SEAT[raw["Seat type"] ?? ""] ?? null,
      cabinClass: FR24_CLASS[raw["Flight class"] ?? ""] ?? null,
      reason: FR24_REASON[raw["Flight reason"] ?? ""] ?? null,
      notes: raw["Note"],
      sourceKind: "fr24_csv",
      sourceRow,
    },
    ref,
  );
  if (scheduledDate) {
    const t = buildFlightTimes({
      scheduledDate,
      originTz: fromAirport?.tz ?? null,
      destTz: toAirport?.tz ?? null,
      takeoff: raw["Dep time"],
      landing: raw["Arr time"],
      durationMin: parseDuration(raw["Duration"] ?? ""),
    });
    values = { ...values, takeoffAt: t.takeoffAt, landingAt: t.landingAt };
    issues.push(...t.issues);
  }
  const external: FlightCandidate["external"] = [];
  for (const k of ["Dep_id", "Arr_id", "Airline_id", "Aircraft_id"]) {
    const v = raw[k];
    if (v && v !== "0") external.push({ system: "fr24", key: k, value: v });
  }
  return { table: "flights", sourceRow, raw, values, issues, external, airframeFacts: {} };
}
