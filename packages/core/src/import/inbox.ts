// The inbox file (docs/21-import-export.md, "Source: spotting session"): the sightings `touchdown spot` filled and
// checked, or the flights and sightings `touchdown add` checked, with where each value came from and what is still
// open. The Import page reads it like any other file; values from a lookup or an agent get a `field_provenance` row
// on commit. Version 2 added flights; version 1 files (sightings only) are still read.

import type { RefIndex } from "../ref/index.ts";
import { PHASES, type PROVENANCE_SOURCES, type SightingValues } from "../schema/tables.ts";
import { isValidDate } from "../schema/validate.ts";
import { normaliseSighting } from "../normalise/record.ts";
import type { AirframeFacts } from "../identity/facts.ts";
import { SPOT_FIELDS, type SpotField, type SpotSource, type SpotValues } from "../spot/entry.ts";
import { storedFields } from "../agent/check.ts";
import type { Candidate, FlightCandidate, ImportIssue, ParsedSource, SightingCandidate } from "./candidate.ts";
import { readMapped, type ColumnField } from "./mapping.ts";

export const INBOX_SCHEMA = "touchdown-inbox";
export const INBOX_VERSION = 2;
const MAX_RECORDS = 5000;

/** A flight's fields, named as in the column mapping. Ticket numbers and booking references are never in the inbox. */
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
  values: Partial<Record<InboxFlightField, string>>;
  /** Where each value came from; a value without one was typed (by the user, or the agent working for them). */
  sources?: Partial<Record<InboxFlightField, SpotSource>>;
  open: string[];
}

export interface InboxFile {
  schema: typeof INBOX_SCHEMA;
  version: 1 | typeof INBOX_VERSION;
  createdAt: string;
  checker: "claude" | "codex" | null;
  sightings: InboxSighting[];
  /** Version 2. */
  flights?: InboxFlight[];
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

/** Checks an inbox file and turns it into rows for the import review. */
export function readInbox(json: unknown, fileName: string, ref: RefIndex): { source: ParsedSource } | { error: string } {
  const f = json as Partial<InboxFile> | null;
  if (!f || typeof f !== "object" || f.schema !== INBOX_SCHEMA) return { error: "not a Touchdown inbox file" };
  if (f.version !== 1 && f.version !== INBOX_VERSION) return { error: "an inbox file from another version of Touchdown" };
  if (f.checker !== null && f.checker !== "claude" && f.checker !== "codex") return { error: "unknown checker" };
  const flights = f.version === 1 ? [] : (f.flights ?? []);
  if (!Array.isArray(f.sightings) || !Array.isArray(flights)) return { error: "malformed: no list of sightings or flights" };
  const extra = Object.keys(f).filter((k) => !["schema", "version", "createdAt", "checker", "sightings", ...(f.version === 1 ? [] : ["flights"])].includes(k));
  if (extra.length) return { error: `unexpected keys: ${extra.join(", ")}` };
  const total = f.sightings.length + flights.length;
  if (!total || total > MAX_RECORDS) return { error: `no records, or more than ${MAX_RECORDS}` };
  const fields = new Set<string>(SPOT_FIELDS);
  const candidates: Candidate[] = [];
  for (const [i, s] of f.sightings.entries()) {
    const n = i + 1;
    if (!s || typeof s !== "object") return { error: `sighting ${n} is malformed` };
    const keys = Object.keys(s).filter((k) => !["values", "sources", "open", "missing", "aircraft", "tags"].includes(k));
    if (keys.length) return { error: `sighting ${n}: unexpected keys ${keys.join(", ")}` };
    for (const [k, v] of Object.entries(s.values ?? {})) if (!fields.has(k) || !isText(v, k === "notes" ? 500 : 200)) return { error: `sighting ${n}: field ${k} is not allowed` };
    for (const [k, v] of Object.entries(s.sources ?? {})) if (!fields.has(k) || !SOURCES.has(v as SpotSource)) return { error: `sighting ${n}: unknown source for ${k}` };
    if (!Array.isArray(s.open) || s.open.some((x) => typeof x !== "string" || x.length > 300) || s.open.length > 20) return { error: `sighting ${n}: malformed notes on what is open` };
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
  const flightFields = new Set<string>(INBOX_FLIGHT_FIELDS);
  for (const [i, fl] of flights.entries()) {
    const n = i + 1;
    if (!fl || typeof fl !== "object") return { error: `flight ${n} is malformed` };
    const keys = Object.keys(fl).filter((k) => !["values", "sources", "open"].includes(k));
    if (keys.length) return { error: `flight ${n}: unexpected keys ${keys.join(", ")}` };
    for (const [k, v] of Object.entries(fl.values ?? {})) if (!flightFields.has(k) || !isText(v, k === "notes" ? 500 : 200)) return { error: `flight ${n}: field ${k} is not allowed` };
    for (const [k, v] of Object.entries(fl.sources ?? {})) if (!flightFields.has(k) || !SOURCES.has(v as SpotSource)) return { error: `flight ${n}: unknown source for ${k}` };
    if (!Array.isArray(fl.open) || fl.open.some((x) => typeof x !== "string" || x.length > 300) || fl.open.length > 20) return { error: `flight ${n}: malformed notes on what is open` };
    const v = fl.values ?? {};
    if (!v.flightNumber && !(v.from && v.to) && !v.registration) return { error: `flight ${n} has no flight number, route or registration` };
    for (const k of ["date", "firstFlight"] as const) if (v[k] && !isValidDate(v[k])) return { error: `flight ${n}: ${v[k]} is not a date (YYYY-MM-DD)` };
    candidates.push(inboxFlight(fl, f.sightings.length + n, fileName, ref));
  }
  return { source: { format: "touchdown_inbox", fileName, candidates, rowsRead: candidates.length, agentChecker: f.checker ?? null } };
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
  const sheet = { name: fileName, header: [...INBOX_FLIGHT_FIELDS], rows: [INBOX_FLIGHT_FIELDS.map((k) => v[k] ?? null)], firstRow: sourceRow };
  const c = readMapped(sheet, { kind: "flights", fields: [...INBOX_FLIGHT_FIELDS] }, fileName, ref).candidates[0] as FlightCandidate;
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
