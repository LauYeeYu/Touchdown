// Parsers for the known sources (docs/21-import-export.md): the my.flightradar24.com CSV export, the flight
// log spreadsheet and the spotting spreadsheet (docs/01-existing-data.md).

import { looksLikeOperatorName, type RefIndex } from "../ref/index.ts";
import type { FlightValues, SightingValues } from "../schema/tables.ts";
import { normaliseFlight, normaliseSighting } from "../normalise/record.ts";
import { normaliseRegistration } from "../normalise/registration.ts";
import { parseFareClass } from "../normalise/flight.ts";
import { haversineKm } from "../geo/index.ts";
import { parseDuration, parseLooseDate, serialToDate } from "../time/index.ts";
import { buildFlightTimes } from "./times.ts";
import { cellText, type SheetData } from "./read.ts";
import { rawRecord, type FlightCandidate, type ImportIssue, type ParsedSource, type SightingCandidate, type SourceFormat } from "./candidate.ts";

const FR24_HEADER = ["Date", "Flight number", "From", "To", "Dep time", "Arr time", "Duration", "Airline", "Aircraft", "Registration"];
const FLIGHT_LOG_HEADER = ["Date", "Airlines", "Flight Number", "Departure", "Destination", "Registration Number"];
const SPOTTING_HEADER = ["Registration", "Date", "Location", "Airlines", "Type Code", "Status"];

const has = (header: string[], cols: string[]) => cols.every((c) => header.includes(c));

export function detectFormat(header: string[]): SourceFormat | null {
  if (has(header, FR24_HEADER)) return "fr24_csv";
  if (has(header, FLIGHT_LOG_HEADER)) return "flight_log_sheet";
  if (has(header, SPOTTING_HEADER)) return "spotting_sheet";
  return null;
}

export function parseSource(sheet: SheetData, fileName: string, ref: RefIndex): ParsedSource | null {
  const format = detectFormat(sheet.header);
  if (!format) return null;
  const parse = format === "fr24_csv" ? parseFr24Row : format === "flight_log_sheet" ? parseFlightLogRow : parseSpottingRow;
  const candidates = sheet.rows.map((row, i) => parse(rawRecord(sheet.header, row), sheet.firstRow + i, ref, row, sheet.header));
  return { format, fileName, candidates, rowsRead: sheet.rows.length };
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

// ---------- flight log spreadsheet ----------

function parseFlightLogRow(raw: Record<string, string | null>, sourceRow: number, ref: RefIndex): FlightCandidate {
  const issues: ImportIssue[] = [];
  const scheduledDate = parseLooseDate(raw["Date"] ?? "");
  const fare = parseFareClass(raw["Class"]);
  let values: Partial<FlightValues> = normaliseFlight(
    {
      scheduledDate,
      airlineRaw: raw["Airlines"],
      flightNumber: raw["Flight Number"],
      seat: raw["Seat"],
      bookingClass: fare.bookingClass,
      fareBrand: fare.fareBrand,
      cabinClass: fare.cabinClass,
      fromRaw: raw["Departure"],
      departureGate: raw["Gate"],
      toRaw: raw["Destination"],
      ticketNumber: raw["ETKT"]?.replace(/\s+/g, "") || null,
      typeCodeRaw: raw["Type Code"],
      modelRaw: raw["Aircraft"],
      registrationRaw: raw["Registration Number"],
      specialLivery: raw["Special Livery"],
      notes: raw["Misc"],
      sourceKind: "sheet",
      sourceRow,
    },
    ref,
  );
  const from = ref.airport(values.fromAirportId);
  const to = ref.airport(values.toAirportId);
  if (scheduledDate) {
    const t = buildFlightTimes({
      scheduledDate,
      originTz: from?.tz ?? null,
      destTz: to?.tz ?? null,
      boarding: raw["Boarding Time"],
      takeoff: raw["Departure Time"],
      landing: raw["Landing Time"],
      durationMin: parseDuration(raw["Duration"] ?? ""),
    });
    values = { ...values, boardingAt: t.boardingAt, takeoffAt: t.takeoffAt, landingAt: t.landingAt };
    issues.push(...t.issues);
  }
  // The sheet's distance is compared, not stored (V-DISTANCE-DIFF).
  const sheetKm = Number(raw["Distance (km)"]);
  if (from && to && Number.isFinite(sheetKm) && sheetKm > 0) {
    const gc = haversineKm(from, to);
    if (Math.abs(sheetKm - gc) / gc > 0.03) {
      issues.push({ ruleId: "V-DISTANCE-DIFF", severity: "info", field: null, message: `The sheet says ${sheetKm} km; the great-circle distance is ${Math.round(gc)} km. The great-circle distance is used.` });
    }
  }
  const airframeFacts: FlightCandidate["airframeFacts"] = {};
  const ffd = parseLooseDate(raw["First Flight Date"] ?? "");
  if (ffd) airframeFacts.firstFlightDate = ffd;
  return { table: "flights", sourceRow, raw, values, issues, external: [], airframeFacts };
}

// ---------- spotting spreadsheet ----------

const STATUS: Record<string, SightingValues["phase"]> = {
  approaching: "approaching",
  "touching-down": "landing",
  "touching down": "landing",
  landing: "landing",
  "taking-off": "taking_off",
  "taking off": "taking_off",
  taxiing: "taxiing",
  parked: "parked",
  towing: "towing",
  overflight: "overflight",
};

const TAGS: [RegExp, string][] = [
  [/^partial(ly)?\s*body$/i, "partial_body"],
  [/^too\s*far$/i, "too_far"],
  [/^night$/i, "night"],
  [/^backlit$/i, "backlit"],
  [/^blurry$/i, "blurry"],
];

/** Split the spotting sheet's Misc text into livery, tags and notes (docs/21, "Special parsing"). */
export function parseSpottingMisc(misc: string | null | undefined, specialLivery: string | null | undefined) {
  const out = { livery: null as string | null, tags: [] as string[], notes: [] as string[] };
  if (!misc) return out;
  for (const part of misc.split(/\s*[;\n]\s*/).map((p) => p.trim()).filter(Boolean)) {
    const tag = TAGS.find(([re]) => re.test(part));
    if (tag) out.tags.push(tag[1]);
    else if (/livery$/i.test(part) && !specialLivery && !out.livery) out.livery = part;
    else out.notes.push(part);
  }
  return out;
}

let countryNames: Map<string, string> | null = null;
// Retired, reserved and grouping codes that display as a current country's name (DD shows as "Germany").
const RETIRED_REGIONS = new Set(["AC", "AN", "BU", "CP", "CS", "DD", "DG", "EA", "EU", "EZ", "FX", "IC", "NT", "SU", "TA", "TP", "UK", "UN", "YU", "ZR", "ZZ"]);

/** Country as written in the sheet ("US", "Germany", "United Kingdom") → ISO alpha-2. */
export function countryCode(name: string | null | undefined): string | null {
  if (!name) return null;
  const v = name.trim();
  if (v.toUpperCase() === "UK") return "GB";
  if (/^[A-Z]{2}$/.test(v)) return v;
  if (!countryNames) {
    countryNames = new Map();
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    for (let a = 65; a <= 90; a++)
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        if (RETIRED_REGIONS.has(code) || code[0] === "X" || code[0] === "Q") continue;
        const n = dn.of(code);
        // First code wins, so retired or reserved codes (FX, UK) never replace the current one.
        if (n && n !== code && !countryNames.has(n.toLowerCase())) countryNames.set(n.toLowerCase(), code);
      }
    for (const [alias, code] of [
      ["usa", "US"], ["united states of america", "US"], ["uk", "GB"], ["great britain", "GB"], ["england", "GB"],
      ["south korea", "KR"], ["korea", "KR"], ["russia", "RU"], ["turkey", "TR"], ["taiwan", "TW"], ["hong kong", "HK"],
      ["macau", "MO"], ["macao", "MO"], ["uae", "AE"], ["vietnam", "VN"], ["czech republic", "CZ"], ["holland", "NL"],
    ] as const) countryNames.set(alias, code);
  }
  return countryNames.get(v.toLowerCase()) ?? null;
}

function parseSpottingRow(
  raw: Record<string, string | null>,
  sourceRow: number,
  ref: RefIndex,
  row: (string | number | boolean | null)[],
  header: string[],
): SightingCandidate {
  const issues: ImportIssue[] = [];
  const dateCell = row[header.indexOf("Date")];
  const seenOn = typeof dateCell === "number" ? serialToDate(dateCell) : parseLooseDate(cellText(dateCell) ?? "");
  const status = raw["Status"]?.trim().toLowerCase() ?? "";
  const misc = parseSpottingMisc(raw["Misc"], raw["Special Livery"]);
  const values = normaliseSighting(
    {
      seenOn,
      airportRaw: raw["Location"],
      operatorRaw: raw["Airlines"],
      registrationRaw: raw["Registration"],
      typeCodeRaw: raw["Type Code"],
      modelRaw: raw["Aircraft"],
      phase: STATUS[status] ?? (status ? "other" : null),
      specialLivery: raw["Special Livery"],
      livery: misc.livery,
      notes: misc.notes.join("; ") || null,
      sourceKind: "sheet",
      sourceRow,
    },
    ref,
  );
  if (status && !STATUS[status]) issues.push({ ruleId: "I-SOURCE-DIFF", severity: "info", field: "phase", message: `Status "${raw["Status"]}" is not a known phase; stored as "other".` });
  if (!values.operatorId && looksLikeOperatorName(values.operatorRaw)) {
    issues.push({ ruleId: "I-SOURCE-DIFF", severity: "info", field: "operatorId", message: `"${values.operatorRaw}" is a name, not an airline code; it is added as your own operator.` });
  }
  // Country is the registration country: compared with the prefix, not stored (Q-COUNTRY).
  const sheetCountry = countryCode(raw["Country"]);
  const regCountry = normaliseRegistration(values.registration, ref)?.country ?? null;
  // Hong Kong and Macau registrations are commonly filed under China.
  const sameCountry = sheetCountry === regCountry || (sheetCountry === "CN" && (regCountry === "HK" || regCountry === "MO"));
  if (raw["Country"] && sheetCountry && regCountry && !sameCountry) {
    issues.push({ ruleId: "I-SOURCE-DIFF", severity: "warning", field: "registration", message: `The sheet says the registration country is ${raw["Country"]}; ${values.registration} has the ${regCountry} prefix.` });
  }
  return { table: "sightings", sourceRow, raw, values, issues, external: [], airframeFacts: {}, tags: misc.tags };
}
