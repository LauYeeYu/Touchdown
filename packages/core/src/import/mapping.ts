// Reading any spreadsheet (docs/21-import-export.md, "Source: any spreadsheet"): which column holds which field
// is worked out from the headers and the values, the user confirms or changes it, and the rows are read with
// it. Only the my.flightradar24.com export, the same for everyone, has a fixed reader (formats.ts).

import { looksLikeOperatorName, type RefIndex } from "../ref/index.ts";
import type { FlightValues, SightingValues } from "../schema/tables.ts";
import { normaliseFlight, normaliseSighting } from "../normalise/record.ts";
import { normaliseRegistration } from "../normalise/registration.ts";
import { parseFareClass } from "../normalise/flight.ts";
import { parseModel } from "../normalise/model.ts";
import { haversineKm } from "../geo/index.ts";
import { parseDuration, parseLooseDate } from "../time/index.ts";
import { buildFlightTimes } from "./times.ts";
import { cellText, type SheetData } from "./read.ts";
import { rawRecord, type FlightCandidate, type ImportIssue, type ParsedSource, type SightingCandidate } from "./candidate.ts";

export type RowKind = "sightings" | "flights";

/** What a column can hold. `other` is free text the agent sorts into fields (kept as notes without it). */
export const COLUMN_FIELDS = [
  "date",
  "registration",
  "airline",
  "typeCode",
  "model",
  "specialLivery",
  "livery",
  "notes",
  "other",
  "airport",
  "phase",
  "country",
  "flightNumber",
  "from",
  "to",
  "seat",
  "class",
  "gate",
  "boarding",
  "takeoff",
  "landing",
  "duration",
  "distance",
  "ticketNumber",
  "bookingRef",
  "firstFlight",
  "ignore",
] as const;
export type ColumnField = (typeof COLUMN_FIELDS)[number];

const BOTH: RowKind[] = ["sightings", "flights"];
const SIGHTINGS: RowKind[] = ["sightings"];
const FLIGHTS: RowKind[] = ["flights"];

interface FieldDef {
  label: string;
  kinds: RowKind[];
  /** Header names, written lower case with words separated by single spaces. */
  headers: string[];
  /** Several columns may hold it (their text is joined). */
  many?: boolean;
  /** Private: never shown to the agent, never logged (AGENTS.md, "Data and privacy"). */
  private?: boolean;
}

export const FIELD_DEFS: Record<ColumnField, FieldDef> = {
  date: { label: "Date", kinds: BOTH, headers: ["date", "day", "seen on", "date seen", "spotted on", "flight date", "scheduled date"] },
  registration: { label: "Registration", kinds: BOTH, headers: ["registration", "registration number", "registration no", "reg", "reg no", "reg number", "tail", "tail number", "aircraft registration"] },
  airline: { label: "Airline", kinds: BOTH, headers: ["airline", "airlines", "operator", "carrier", "airline code", "operator code"] },
  typeCode: { label: "Type code", kinds: BOTH, headers: ["type code", "icao type", "type designator", "aircraft type code", "type"] },
  model: { label: "Model", kinds: BOTH, headers: ["aircraft", "model", "aircraft model", "variant", "aircraft variant", "aircraft type"] },
  specialLivery: { label: "Special livery", kinds: BOTH, headers: ["special livery", "special scheme", "special colours", "special colors"] },
  livery: { label: "Livery", kinds: BOTH, headers: ["livery", "colours", "colors", "scheme", "paint"] },
  notes: { label: "Notes", kinds: BOTH, headers: ["notes", "note", "comment", "comments", "remarks"], many: true },
  other: { label: "Other text", kinds: BOTH, headers: ["misc", "miscellaneous", "other", "extra", "details", "description"], many: true },
  airport: { label: "Place (airport)", kinds: SIGHTINGS, headers: ["location", "airport", "place", "spotting location", "spot", "airport code", "where"] },
  phase: { label: "Phase", kinds: SIGHTINGS, headers: ["status", "phase", "stage", "flight phase"] },
  country: { label: "Registration country (checked, not stored)", kinds: SIGHTINGS, headers: ["country", "registration country", "reg country"] },
  flightNumber: { label: "Flight number", kinds: FLIGHTS, headers: ["flight number", "flight", "flight no", "flight num", "flight code"] },
  from: { label: "From", kinds: FLIGHTS, headers: ["departure", "from", "origin", "departure airport", "dep", "from airport"] },
  to: { label: "To", kinds: FLIGHTS, headers: ["destination", "to", "arrival", "arrival airport", "dest", "arr", "to airport"] },
  seat: { label: "Seat", kinds: FLIGHTS, headers: ["seat", "seat number", "seat no"] },
  class: { label: "Class or fare", kinds: FLIGHTS, headers: ["class", "cabin", "fare", "fare class", "booking class", "travel class", "cabin class"] },
  gate: { label: "Departure gate", kinds: FLIGHTS, headers: ["gate", "departure gate"] },
  boarding: { label: "Boarding time", kinds: FLIGHTS, headers: ["boarding time", "boarding"] },
  takeoff: { label: "Takeoff time", kinds: FLIGHTS, headers: ["departure time", "takeoff", "takeoff time", "take off", "take off time", "dep time", "off time", "atd"] },
  landing: { label: "Landing time", kinds: FLIGHTS, headers: ["landing time", "landing", "arrival time", "arr time", "on time", "landed"] },
  duration: { label: "Duration", kinds: FLIGHTS, headers: ["duration", "flight time", "block time", "time in air", "air time"] },
  distance: { label: "Distance in km (checked, not stored)", kinds: FLIGHTS, headers: ["distance", "distance km", "km"] },
  ticketNumber: { label: "Ticket number (private)", kinds: FLIGHTS, headers: ["etkt", "ticket", "ticket number", "e ticket", "eticket", "ticket no"], private: true },
  bookingRef: { label: "Booking reference (private)", kinds: FLIGHTS, headers: ["booking reference", "booking ref", "pnr", "confirmation", "confirmation number", "record locator", "booking"], private: true },
  firstFlight: { label: "Aircraft's first flight", kinds: FLIGHTS, headers: ["first flight date", "first flight"] },
  ignore: { label: "Not used", kinds: BOTH, headers: ["manufacturer", "maker", "plane family", "family", "aircraft family", "route", "photo", "photos", "link", "url", "id"] },
};

/** Fields that mark a file of flights rather than sightings. */
const FLIGHT_MARKERS: ColumnField[] = ["flightNumber", "from", "to", "boarding", "takeoff", "landing", "seat", "class"];

const norm = (h: string) =>
  h
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Columns written the same way give the same signature, so a confirmed mapping can be used again. */
export function headerSignature(header: string[]): string {
  return header.map(norm).join("|");
}

// ---------- recognising values ----------

const STATUS: Record<string, SightingValues["phase"]> = {
  approaching: "approaching",
  approach: "approaching",
  "touching-down": "landing",
  "touching down": "landing",
  landing: "landing",
  landed: "landing",
  "taking-off": "taking_off",
  "taking off": "taking_off",
  takeoff: "taking_off",
  "take-off": "taking_off",
  taxiing: "taxiing",
  taxi: "taxiing",
  parked: "parked",
  towing: "towing",
  overflight: "overflight",
};

/** A phase as written in a sheet ("Touching-down" → landing), or null. */
export function phaseOf(text: string): SightingValues["phase"] | null {
  return STATUS[text.trim().toLowerCase()] ?? null;
}

const CLOCK = /^\d{1,2}:\d{2}(:\d{2})?$/;
const FLIGHT_NO = /^[A-Z0-9]{2}[A-Z]?\s?\d{1,4}[A-Z]?$/;

/** How well a value fits a field: used to confirm a header, or to place a column without one. */
function fits(field: ColumnField, v: string, ref: RefIndex): boolean {
  const u = v.trim().toUpperCase();
  switch (field) {
    case "registration": {
      const r = normaliseRegistration(u, ref);
      return !!r?.knownFormat && (/[\d-]/.test(u) || u.length >= 4);
    }
    case "date":
    case "firstFlight":
      return !!parseLooseDate(v);
    case "airport":
    case "from":
    case "to":
      return /^[A-Z0-9]{3,4}$/.test(u) && !!ref.airportByCode(u);
    case "airline":
      return (/^[A-Z0-9]{2,3}$/.test(u) && !!ref.operatorByCode(u)) || !!ref.operatorByCode(v);
    case "typeCode":
      return !!ref.type(u);
    case "model": {
      const m = parseModel(v)?.standard;
      return !!m && ref.typesForModel(m).length > 0;
    }
    case "flightNumber":
      return FLIGHT_NO.test(u);
    case "boarding":
    case "takeoff":
    case "landing":
      return CLOCK.test(v.trim()) || /^0?\.\d+$/.test(v.trim());
    case "duration":
      return /^\d{1,3}:\d{2}(:\d{2})?$/.test(v.trim());
    case "phase":
      return !!phaseOf(v);
    case "seat":
      return /^\d{1,3}[A-K]$/.test(u);
    case "distance":
      return /^\d+(\.\d+)?$/.test(v.trim());
    default:
      return false;
  }
}

// Fields a column can be placed in by its values alone, most specific first: a type code is one of a known set,
// so it goes before a flight number, which "A21N" or "B738" would also pass for.
const BY_VALUE: ColumnField[] = ["registration", "typeCode", "flightNumber", "model", "phase", "seat", "date", "duration", "takeoff", "airport", "airline"];

// ---------- guessing ----------

export type MappingConfidence = "sure" | "likely" | "unsure";

export interface ColumnGuess {
  index: number;
  header: string;
  field: ColumnField;
  confidence: MappingConfidence;
  /** Up to five values from the column, for the user to check against (never for private fields). */
  samples: string[];
  /** Why the field was chosen, or what is unclear. */
  why: string;
}

export interface SheetMapping {
  kind: RowKind;
  columns: ColumnGuess[];
}

const SAMPLE_ROWS = 50;

function valuesOf(sheet: SheetData, i: number): string[] {
  const out: string[] = [];
  for (const row of sheet.rows) {
    const v = cellText(row[i]);
    if (v) out.push(v);
    if (out.length >= SAMPLE_ROWS) break;
  }
  return out;
}

const share = (values: string[], field: ColumnField, ref: RefIndex) => (values.length ? values.filter((v) => fits(field, v, ref)).length / values.length : 0);

/**
 * Works out which column holds which field. A header the reader knows decides, when the values agree; a column
 * without one is placed by its values when most of them fit a field. Anything else is marked unsure and not
 * used until the user (or the agent, in the CLI) says what it is.
 */
export function guessMapping(sheet: SheetData, ref: RefIndex): SheetMapping {
  const columns: ColumnGuess[] = sheet.header.map((header, index) => {
    const values = valuesOf(sheet, index);
    const h = norm(header ?? "");
    const named = (COLUMN_FIELDS as readonly ColumnField[]).find((f) => FIELD_DEFS[f].headers.includes(h)) ?? null;
    const samples = (named && FIELD_DEFS[named].private) || !values.length ? [] : [...new Set(values)].slice(0, 5);
    const byValue = BY_VALUE.map((f) => ({ f, s: share(values, f, ref) })).sort((a, b) => b.s - a.s)[0]!;
    if (!h && !values.length) return { index, header, field: "ignore", confidence: "sure", samples, why: "empty column" };
    if (named) {
      const testable = BY_VALUE.includes(named) || named === "from" || named === "to" || named === "boarding" || named === "landing" || named === "distance" || named === "firstFlight";
      if (!testable || !values.length) return { index, header, field: named, confidence: "sure", samples, why: "its header" };
      const s = share(values, named, ref);
      if (s >= 0.6) return { index, header, field: named, confidence: "sure", samples, why: "its header and values" };
      // "Type" holding model names, say: the values say otherwise.
      if (byValue.s >= 0.8 && byValue.f !== named) return { index, header, field: byValue.f, confidence: "unsure", samples, why: `the header says ${FIELD_DEFS[named].label.toLowerCase()}, but the values look like ${FIELD_DEFS[byValue.f].label.toLowerCase()}` };
      return { index, header, field: named, confidence: "likely", samples, why: "its header (few values fit)" };
    }
    if (byValue.s >= 0.8) return { index, header, field: byValue.f, confidence: "likely", samples, why: `its values look like ${FIELD_DEFS[byValue.f].label.toLowerCase()}` };
    return { index, header, field: "ignore", confidence: "unsure", samples, why: "neither its header nor its values identify it" };
  });

  // One column per field, except for text that can be joined: the surer (then the first) keeps it.
  const rank = { sure: 0, likely: 1, unsure: 2 };
  const taken = new Map<ColumnField, ColumnGuess>();
  for (const c of [...columns].sort((a, b) => rank[a.confidence] - rank[b.confidence] || a.index - b.index)) {
    if (c.field === "ignore" || FIELD_DEFS[c.field].many) continue;
    const first = taken.get(c.field);
    if (!first) taken.set(c.field, c);
    else Object.assign(c, { field: "ignore", confidence: "unsure", why: `column ${first.index + 1} ("${first.header}") already holds ${FIELD_DEFS[c.field].label.toLowerCase()}` });
  }

  // Only columns placed with some confidence decide between flights and sightings.
  const kind: RowKind = columns.some((c) => c.confidence !== "unsure" && FLIGHT_MARKERS.includes(c.field)) ? "flights" : "sightings";
  // A field of the other kind is not used ("Gate" in a file of sightings).
  for (const c of columns) {
    if (c.field !== "ignore" && !FIELD_DEFS[c.field].kinds.includes(kind)) Object.assign(c, { field: "ignore", confidence: "unsure", why: `${FIELD_DEFS[c.field].label.toLowerCase()} is not part of ${kind}` });
  }
  return { kind, columns };
}

/** Columns the user should look at before the rows are read. */
export function unsureColumns(m: SheetMapping): ColumnGuess[] {
  return m.columns.filter((c) => c.confidence === "unsure" && (c.header || c.samples.length));
}

/** What a mapping needs before rows can be read with it, or null when it is enough. */
export function mappingProblem(m: { kind: RowKind; fields: ColumnField[] }): string | null {
  const has = (f: ColumnField) => m.fields.includes(f);
  for (const f of COLUMN_FIELDS) {
    if (f === "ignore" || FIELD_DEFS[f].many) continue;
    const at = m.fields.flatMap((x, i) => (x === f ? [i + 1] : []));
    if (at.length > 1) return `Columns ${at.join(" and ")} both hold the ${FIELD_DEFS[f].label.toLowerCase()}. Choose one.`;
  }
  if (m.kind === "sightings" && !has("registration")) return "No column holds the registration.";
  if (m.kind === "flights" && !has("date")) return "No column holds the date.";
  if (m.kind === "flights" && !has("flightNumber") && !(has("from") && has("to"))) return "No column holds the flight number, or the from and to airports.";
  return null;
}

// ---------- reading rows ----------

const TAGS: [RegExp, string][] = [
  [/^partial(ly)?\s*body$/i, "partial_body"],
  [/^too\s*far$/i, "too_far"],
  [/^night$/i, "night"],
  [/^backlit$/i, "backlit"],
  [/^blurry$/i, "blurry"],
];

/**
 * Split a sighting's free text into photo tags, a livery and notes (docs/21, "Special parsing"): known photo
 * notes ("Partial body", "Too far") become tags; a part ending in "livery" is the livery when there is no
 * special livery; the rest stays as notes.
 */
export function splitSightingText(text: string | null | undefined, specialLivery: string | null | undefined) {
  const out = { livery: null as string | null, tags: [] as string[], notes: [] as string[] };
  if (!text) return out;
  for (const part of text.split(/\s*[;\n]\s*/).map((p) => p.trim()).filter(Boolean)) {
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

/** A country as written in a sheet ("US", "Germany", "United Kingdom") → ISO alpha-2. */
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

/** A spreadsheet time cell as a clock time: "10:40", "10:40:00", or a day fraction from Excel (0.4444). */
function clockText(v: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  if (/^0?\.\d+$/.test(t)) {
    const min = Math.round(Number(t) * 1440) % 1440;
    return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  }
  return t;
}

type Get = (f: ColumnField) => string | null;

function sightingRow(get: Get, raw: Record<string, string | null>, sourceRow: number, ref: RefIndex): SightingCandidate {
  const issues: ImportIssue[] = [];
  const status = get("phase")?.trim() ?? "";
  const special = get("specialLivery");
  const text = [get("notes"), get("other")].filter(Boolean).join(" · ");
  const split = splitSightingText(text, special);
  const values = normaliseSighting(
    {
      seenOn: parseLooseDate(get("date") ?? ""),
      airportRaw: get("airport"),
      operatorRaw: get("airline"),
      registrationRaw: get("registration"),
      typeCodeRaw: get("typeCode"),
      modelRaw: get("model"),
      phase: status ? (phaseOf(status) ?? "other") : null,
      specialLivery: special,
      livery: get("livery") ?? split.livery,
      notes: split.notes.join(" · ") || null,
      sourceKind: "sheet",
      sourceRow,
    },
    ref,
  );
  if (status && !phaseOf(status)) issues.push({ ruleId: "I-SOURCE-DIFF", severity: "info", field: "phase", message: `Status "${status}" is not a known phase, so it is stored as "other".` });
  if (!values.operatorId && looksLikeOperatorName(values.operatorRaw)) {
    issues.push({ ruleId: "I-SOURCE-DIFF", severity: "info", field: "operatorId", message: `"${values.operatorRaw}" is a name, not an airline code, so it is added as an operator.` });
  }
  // The country is the registration country: compared with the prefix, not stored (Q-COUNTRY).
  const country = get("country");
  const sheetCountry = countryCode(country);
  const regCountry = normaliseRegistration(values.registration, ref)?.country ?? null;
  // Hong Kong and Macau registrations are commonly filed under China.
  const sameCountry = sheetCountry === regCountry || (sheetCountry === "CN" && (regCountry === "HK" || regCountry === "MO"));
  if (country && sheetCountry && regCountry && !sameCountry) {
    issues.push({ ruleId: "I-SOURCE-DIFF", severity: "warning", field: "registration", message: `The sheet says the registration country is ${country}, but ${values.registration} has the ${regCountry} prefix.` });
  }
  return { table: "sightings", sourceRow, raw, values, issues, external: [], airframeFacts: {}, tags: split.tags };
}

function flightRow(get: Get, raw: Record<string, string | null>, sourceRow: number, ref: RefIndex): FlightCandidate {
  const issues: ImportIssue[] = [];
  const scheduledDate = parseLooseDate(get("date") ?? "");
  const fare = parseFareClass(get("class"));
  let values: Partial<FlightValues> = normaliseFlight(
    {
      scheduledDate,
      airlineRaw: get("airline"),
      flightNumber: get("flightNumber"),
      seat: get("seat"),
      bookingClass: fare.bookingClass,
      fareBrand: fare.fareBrand,
      cabinClass: fare.cabinClass,
      fromRaw: get("from"),
      departureGate: get("gate"),
      toRaw: get("to"),
      ticketNumber: get("ticketNumber")?.replace(/\s+/g, "") || null,
      bookingRef: get("bookingRef")?.trim() || null,
      typeCodeRaw: get("typeCode"),
      modelRaw: get("model"),
      registrationRaw: get("registration"),
      specialLivery: get("specialLivery"),
      livery: get("livery"),
      notes: [get("notes"), get("other")].filter(Boolean).join(" · ") || null,
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
      boarding: clockText(get("boarding")),
      takeoff: clockText(get("takeoff")),
      landing: clockText(get("landing")),
      durationMin: parseDuration(get("duration") ?? ""),
    });
    values = { ...values, boardingAt: t.boardingAt, takeoffAt: t.takeoffAt, landingAt: t.landingAt };
    issues.push(...t.issues);
  }
  // The sheet's distance is compared, not stored (V-DISTANCE-DIFF).
  const sheetKm = Number(get("distance"));
  if (from && to && Number.isFinite(sheetKm) && sheetKm > 0) {
    const gc = haversineKm(from, to);
    if (Math.abs(sheetKm - gc) / gc > 0.03) {
      issues.push({ ruleId: "V-DISTANCE-DIFF", severity: "info", field: null, message: `The sheet says ${sheetKm} km, but the great-circle distance is ${Math.round(gc)} km. The great-circle distance is used.` });
    }
  }
  const airframeFacts: FlightCandidate["airframeFacts"] = {};
  const ffd = parseLooseDate(get("firstFlight") ?? "");
  if (ffd) airframeFacts.firstFlightDate = ffd;
  return { table: "flights", sourceRow, raw, values, issues, external: [], airframeFacts };
}

/** Reads the rows with a mapping (the field of each column, by position). */
export function readMapped(sheet: SheetData, mapping: { kind: RowKind; fields: ColumnField[] }, fileName: string, ref: RefIndex): ParsedSource {
  const columnsOf = new Map<ColumnField, number[]>();
  mapping.fields.forEach((f, i) => {
    if (f === "ignore" || !FIELD_DEFS[f].kinds.includes(mapping.kind)) return;
    // One column per field, except for text that can be joined.
    if (columnsOf.has(f) && !FIELD_DEFS[f].many) return;
    columnsOf.set(f, [...(columnsOf.get(f) ?? []), i]);
  });
  const candidates = sheet.rows.map((row, i) => {
    const get: Get = (f) => {
      const parts = (columnsOf.get(f) ?? []).map((c) => cellText(row[c])).filter((v): v is string => !!v);
      return parts.length ? parts.join(" · ") : null;
    };
    const raw = rawRecord(sheet.header, row);
    return mapping.kind === "flights" ? flightRow(get, raw, sheet.firstRow + i, ref) : sightingRow(get, raw, sheet.firstRow + i, ref);
  });
  return { format: "sheet", fileName, candidates, rowsRead: sheet.rows.length };
}

/** The mapping as positions, for readMapped and for saving. */
export const fieldsOf = (m: SheetMapping): { kind: RowKind; fields: ColumnField[] } => ({ kind: m.kind, fields: m.columns.map((c) => c.field) });
