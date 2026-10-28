// The inbox file (docs/21-import-export.md, "Source: spotting session"): the sightings `touchdown spot` filled and
// checked, or the flights and sightings `touchdown add` checked, with where each value came from and what is still
// open. The Import page reads it like any other file; values from a lookup or an agent get a `field_provenance` row
// on commit. Version 2 added flights; version 3 changes to records in the log (import/changes.ts, docs/34), a
// flight's ticket number and booking reference, given by the user, and a spreadsheet's rows (`touchdown import`).
// Versions 1 and 2 are still read.

import type { RefIndex } from "../ref/index.ts";
import { PHASES, type PROVENANCE_SOURCES, type SightingValues } from "../schema/tables.ts";
import { isValidDate } from "../schema/validate.ts";
import { normaliseSighting } from "../normalise/record.ts";
import type { AirframeFacts } from "../identity/facts.ts";
import { SPOT_FIELDS, type SpotField, type SpotSource, type SpotValues } from "../spot/entry.ts";
import { storedFields } from "../agent/check.ts";
import type { Candidate, FlightCandidate, ImportIssue, ParsedSource, SightingCandidate } from "./candidate.ts";
import { COLUMN_FIELDS, mappingProblem, readMapped, type ColumnField, type RowKind } from "./mapping.ts";
import { readChanges, type InboxChange } from "./changes.ts";
import { isFr24Export, parseSource } from "./formats.ts";
import type { Cell } from "./read.ts";

export const INBOX_SCHEMA = "touchdown-inbox";
export const INBOX_VERSION = 3;
const MAX_RECORDS = 5000;
const MAX_SHEET_ROWS = 50_000;

/** A flight's fields, named as in the column mapping. */
export const INBOX_FLIGHT_FIELDS = [
  "date",
  "flightNumber",
  "airline",
  "from",
  "to",
  "registration",
  "typeCode",
  "model",
  "livery",
  "specialLivery",
  "seat",
  "class",
  "gate",
  "boarding",
  "takeoff",
  "landing",
  "duration",
  "firstFlight",
  "notes",
] as const satisfies readonly ColumnField[];
export type InboxFlightField = (typeof INBOX_FLIGHT_FIELDS)[number];

/** A flight's private fields (version 3): in the file only when the user gave them, never shown on the command line. */
export const INBOX_PRIVATE_FIELDS = ["ticketNumber", "bookingRef"] as const satisfies readonly ColumnField[];
export type InboxPrivateField = (typeof INBOX_PRIVATE_FIELDS)[number];

/** Facts about the aircraft from a lookup, stored on the airframe when they fit the user's records. */
export interface InboxAircraft {
  manufacturer: string | null;
  msn: string | null;
  lineNumber: string | null;
  firstFlightDate: string | null;
  provider: string;
  url: string | null;
  fetchedAt: string;
}

export interface InboxSighting {
  values: SpotValues;
  /** Where each value came from. A value the user typed is "you". */
  sources: Partial<Record<SpotField, SpotSource>>;
  /** Things still missing or doubtful, in words; shown on the Import page. */
  open: string[];
  /** Fields the user chose to leave empty. */
  missing: SpotField[];
  /** Photo notes from a spreadsheet's text ("partial_body", "too_far"). */
  tags?: string[];
  aircraft: InboxAircraft | null;
}

export interface InboxFlight {
  values: Partial<Record<InboxFlightField | InboxPrivateField, string>>;
  /** Where each value came from; a value without one was typed (by the user, or the agent working for them). */
  sources?: Partial<Record<InboxFlightField, SpotSource>>;
  open: string[];
}

/**
 * A spreadsheet or Flightradar24 export as `touchdown import` read it (version 3, docs/34): the rows, with the
 * columns the user confirmed. The review reads it as the Import page reads the file itself.
 */
export interface InboxSheet {
  /** The file it came from: "flights.xlsx". */
  fileName: string;
  /** The sheet (tab) read; a CSV file's name. */
  name: string;
  header: string[];
  rows: Cell[][];
  /** The row number of the first row in the file, from 1. */
  firstRow: number;
  /** What each column holds; null for the Flightradar24 export, which has its own reader. */
  mapping: { kind: RowKind; fields: ColumnField[] } | null;
}

export interface InboxFile {
  schema: typeof INBOX_SCHEMA;
  version: 1 | 2 | typeof INBOX_VERSION;
  createdAt: string;
  checker: "claude" | "codex" | null;
  sightings: InboxSighting[];
  /** Version 2. */
  flights?: InboxFlight[];
  /** Version 3: changes to records in the log. */
  changes?: InboxChange[];
  /** Version 3: a spreadsheet's rows. A file with one holds no records or changes besides. */
  sheet?: InboxSheet;
}

const SOURCES = new Set<SpotSource>(["you", "your_log", "opensky", "adsbdb", "fr24", "derived", "claude", "codex"]);

export function inboxAircraft(f: AirframeFacts | null): InboxAircraft | null {
  if (!f?.msn) return null;
  return { manufacturer: f.manufacturer, msn: f.msn, lineNumber: f.lineNumber, firstFlightDate: f.firstFlightDate, provider: f.provider, url: f.url, fetchedAt: f.fetchedAt };
}

/** The provenance row a value's source gets: none for what the user typed. */
function provenanceOf(source: SpotSource): { source: (typeof PROVENANCE_SOURCES)[number]; detail: string | null } | null {
  switch (source) {
    case "you":
      return null;
    case "your_log":
      return { source: "derived", detail: "your log" };
    case "derived":
      return { source: "derived", detail: "model" };
    case "claude":
    case "codex":
      return { source: "agent", detail: source };
    default:
      return { source: "lookup", detail: source };
  }
}

const isText = (v: unknown, max: number) => v === null || (typeof v === "string" && v.length <= max);

/** Checks an inbox file and turns it into rows for the import review, and the changes it holds. */
export function readInbox(json: unknown, fileName: string, ref: RefIndex): { source: ParsedSource; changes: InboxChange[] } | { error: string } {
  const f = json as Partial<InboxFile> | null;
  if (!f || typeof f !== "object" || f.schema !== INBOX_SCHEMA) return { error: "not a Touchdown inbox file" };
  if (f.version !== 1 && f.version !== 2 && f.version !== INBOX_VERSION) return { error: "an inbox file from another version of Touchdown" };
  if (f.checker !== null && f.checker !== "claude" && f.checker !== "codex") return { error: "unknown checker" };
  const flights = f.version === 1 ? [] : (f.flights ?? []);
  if (!Array.isArray(f.sightings) || !Array.isArray(flights)) return { error: "malformed: no list of sightings or flights" };
  const extra = Object.keys(f).filter((k) => !["schema", "version", "createdAt", "checker", "sightings", ...(f.version === 1 ? [] : ["flights"]), ...(f.version === 3 ? ["changes", "sheet"] : [])].includes(k));
  if (extra.length) return { error: `unexpected keys: ${extra.join(", ")}` };
  if (f.version === 3 && f.sheet !== undefined) {
    if (f.sightings.length || flights.length || f.changes?.length) return { error: "a file with a spreadsheet holds nothing else" };
    const read = readSheet(f.sheet, ref);
    return "error" in read ? read : { source: read, changes: [] };
  }
  const read = f.version === 3 ? readChanges(f.changes ?? []) : { changes: [] };
  if ("error" in read) return read;
  const total = f.sightings.length + flights.length;
  if ((!total && !read.changes.length) || total > MAX_RECORDS) return { error: `no records or changes, or more than ${MAX_RECORDS} records` };
  const fields = new Set<string>(SPOT_FIELDS);
  const candidates: Candidate[] = [];
  for (const [i, s] of f.sightings.entries()) {
    const n = i + 1;
    if (!s || typeof s !== "object") return { error: `sighting ${n} is malformed` };
    const keys = Object.keys(s).filter((k) => !["values", "sources", "open", "missing", "aircraft", "tags"].includes(k));
    if (keys.length) return { error: `sighting ${n}: unexpected keys ${keys.join(", ")}` };
    for (const [k, v] of Object.entries(s.values ?? {})) if (!fields.has(k) || !isText(v, k === "notes" ? 500 : 200)) return { error: `sighting ${n}: field ${k} is not allowed` };
    for (const [k, v] of Object.entries(s.sources ?? {})) if (!fields.has(k) || !SOURCES.has(v as SpotSource)) return { error: `sighting ${n}: unknown source for ${k}` };
    if (!Array.isArray(s.open) || s.open.some((x) => typeof x !== "string" || x.length > 300) || s.open.length > 20) return { error: `sighting ${n}: malformed notes on the open fields` };
    if (!Array.isArray(s.missing) || s.missing.some((x) => !fields.has(x))) return { error: `sighting ${n}: malformed missing fields` };
    if (s.tags !== undefined && (!Array.isArray(s.tags) || s.tags.length > 20 || s.tags.some((t) => typeof t !== "string" || !/^[a-z_]{1,40}$/.test(t)))) return { error: `sighting ${n}: malformed tags` };
    const v = s.values;
    if (!v.registration) return { error: `sighting ${n} has no registration` };
    if (v.date && !isValidDate(v.date)) return { error: `sighting ${n}: ${v.date} is not a date` };
    if (v.phase && !(PHASES as readonly string[]).includes(v.phase)) return { error: `sighting ${n}: ${v.phase} is not a phase` };
    const a = s.aircraft;
    if (a !== null && (typeof a !== "object" || !a.msn || typeof a.provider !== "string" || ![a.manufacturer, a.msn, a.lineNumber, a.firstFlightDate, a.url].every((x) => isText(x, 300)))) {
      return { error: `sighting ${n}: malformed aircraft facts` };
    }

    const values = normaliseSighting(
      {
        seenOn: v.date ?? null,
        airportRaw: v.airport ?? null,
        registrationRaw: v.registration,
        operatorRaw: v.operator ?? null,
        typeCodeRaw: v.typeCode ?? null,
        modelRaw: v.model ?? null,
        phase: (v.phase as SightingValues["phase"]) ?? null,
        livery: v.livery ?? null,
        specialLivery: v.specialLivery ?? null,
        notes: v.notes ?? null,
        sourceKind: "manual",
        sourceRow: n,
      },
      ref,
    );
    const issues: ImportIssue[] = s.open.map((message) => ({ ruleId: "I-SOURCE-DIFF", severity: "warning", field: null, message }));
    const provenance = Object.entries(s.sources ?? {}).flatMap(([field, source]) => {
      const p = provenanceOf(source as SpotSource);
      return p ? storedFields("sighting", field as SpotField).map((stored) => ({ field: stored, ...p })) : [];
    });
    const raw = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x ?? null]));
    const lookup: AirframeFacts | undefined = a
      ? { ...a, registration: values.registration ?? v.registration, typeText: null, typeCode: values.typeCode ?? null, deliveryDate: null, status: null, registrations: [] }
      : undefined;
    candidates.push({ table: "sightings", sourceRow: n, raw, values, issues, external: [], airframeFacts: lookup ? { lookup } : {}, tags: s.tags ?? [], provenance } satisfies SightingCandidate);
  }
  const flightFields = new Set<string>([...INBOX_FLIGHT_FIELDS, ...(f.version === 3 ? INBOX_PRIVATE_FIELDS : [])]);
  for (const [i, fl] of flights.entries()) {
    const n = i + 1;
    if (!fl || typeof fl !== "object") return { error: `flight ${n} is malformed` };
    const keys = Object.keys(fl).filter((k) => !["values", "sources", "open"].includes(k));
    if (keys.length) return { error: `flight ${n}: unexpected keys ${keys.join(", ")}` };
    for (const [k, v] of Object.entries(fl.values ?? {})) if (!flightFields.has(k) || !isText(v, k === "notes" ? 500 : 200)) return { error: `flight ${n}: field ${k} is not allowed` };
    for (const [k, v] of Object.entries(fl.sources ?? {})) if (!flightFields.has(k) || !SOURCES.has(v as SpotSource)) return { error: `flight ${n}: unknown source for ${k}` };
    if (!Array.isArray(fl.open) || fl.open.some((x) => typeof x !== "string" || x.length > 300) || fl.open.length > 20) return { error: `flight ${n}: malformed notes on the open fields` };
    const v = fl.values ?? {};
    if (!v.flightNumber && !(v.from && v.to) && !v.registration) return { error: `flight ${n} has no flight number, route or registration` };
    for (const k of ["date", "firstFlight"] as const) if (v[k] && !isValidDate(v[k])) return { error: `flight ${n}: ${v[k]} is not a date (YYYY-MM-DD)` };
    candidates.push(inboxFlight(fl, f.sightings.length + n, fileName, ref));
  }
  return { source: { format: "touchdown_inbox", fileName, candidates, rowsRead: candidates.length, agentChecker: f.checker ?? null }, changes: read.changes };
}

/** A spreadsheet's rows, checked and read as the Import page reads the file. */
function readSheet(sh: InboxSheet, ref: RefIndex): ParsedSource | { error: string } {
  if (!sh || typeof sh !== "object") return { error: "malformed spreadsheet" };
  const keys = Object.keys(sh).filter((k) => !["fileName", "name", "header", "rows", "firstRow", "mapping"].includes(k));
  if (keys.length) return { error: `spreadsheet: unexpected keys ${keys.join(", ")}` };
  if (typeof sh.fileName !== "string" || !sh.fileName || sh.fileName.length > 200 || typeof sh.name !== "string" || sh.name.length > 200) return { error: "spreadsheet: malformed file or sheet name" };
  if (!Array.isArray(sh.header) || !sh.header.length || sh.header.length > 200 || sh.header.some((h) => typeof h !== "string" || h.length > 200)) return { error: "spreadsheet: malformed header" };
  if (!Array.isArray(sh.rows) || !sh.rows.length || sh.rows.length > MAX_SHEET_ROWS) return { error: `spreadsheet: no rows, or more than ${MAX_SHEET_ROWS}` };
  if (!Number.isInteger(sh.firstRow) || sh.firstRow < 1) return { error: "spreadsheet: malformed first row" };
  const cell = (c: unknown) => c === null || typeof c === "boolean" || (typeof c === "number" && Number.isFinite(c)) || (typeof c === "string" && c.length <= 2000);
  for (const [i, row] of sh.rows.entries()) if (!Array.isArray(row) || row.length !== sh.header.length || !row.every(cell)) return { error: `spreadsheet: row ${i + 1} is malformed` };
  const m = sh.mapping;
  if (m === null) {
    if (!isFr24Export(sh.header)) return { error: "spreadsheet: no columns given, and it is not the Flightradar24 export" };
  } else {
    if (!m || typeof m !== "object" || (m.kind !== "flights" && m.kind !== "sightings") || !Array.isArray(m.fields) || m.fields.length !== sh.header.length || m.fields.some((x) => !(COLUMN_FIELDS as readonly string[]).includes(x))) return { error: "spreadsheet: malformed columns" };
    const problem = mappingProblem(m);
    if (problem) return { error: `spreadsheet: ${problem}` };
  }
  const source = parseSource({ name: sh.name, header: sh.header, rows: sh.rows, firstRow: sh.firstRow }, sh.fileName, ref, m ?? undefined);
  return source ?? { error: "spreadsheet: its columns do not hold enough to read rows" };
}

/** The stored fields a flight's value sets, for its provenance rows. */
const FLIGHT_STORED: Partial<Record<InboxFlightField, string[]>> = {
  date: ["scheduledDate"],
  airline: ["airlineId"],
  from: ["fromAirportId"],
  to: ["toAirportId"],
  class: ["cabinClass", "bookingClass", "fareBrand"],
  gate: ["departureGate"],
  boarding: ["boardingAt"],
  takeoff: ["takeoffAt"],
  landing: ["landingAt"],
  duration: ["landingAt"],
  firstFlight: [],
};

/** A flight from the inbox, read as a spreadsheet row with these columns would be (times, fare class, …). */
function inboxFlight(fl: InboxFlight, sourceRow: number, fileName: string, ref: RefIndex): FlightCandidate {
  const v = fl.values ?? {};
  const fields = [...INBOX_FLIGHT_FIELDS, ...INBOX_PRIVATE_FIELDS];
  const sheet = { name: fileName, header: fields, rows: [fields.map((k) => v[k] ?? null)], firstRow: sourceRow };
  const c = readMapped(sheet, { kind: "flights", fields }, fileName, ref).candidates[0] as FlightCandidate;
  const provenance = Object.entries(fl.sources ?? {}).flatMap(([field, source]) => {
    const p = provenanceOf(source as SpotSource);
    return p ? (FLIGHT_STORED[field as InboxFlightField] ?? [field]).map((stored) => ({ field: stored, ...p })) : [];
  });
  return {
    ...c,
    raw: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x ?? null])),
    values: { ...c.values, sourceKind: "manual" },
    issues: [...c.issues, ...fl.open.map((message): ImportIssue => ({ ruleId: "I-SOURCE-DIFF", severity: "warning", field: null, message }))],
    provenance,
  };
}
