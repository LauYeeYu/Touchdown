// The inbox file of a spotting session (docs/21-import-export.md, "Source: spotting session"): the sightings
// `touchdown spot` filled and checked, with where each value came from and what is still open. The Import page
// reads it like any other file; values from a lookup or the agent get a `field_provenance` row on commit.

import type { RefIndex } from "../ref/index.ts";
import { PHASES, type PROVENANCE_SOURCES, type SightingValues } from "../schema/tables.ts";
import { isValidDate } from "../schema/validate.ts";
import { normaliseSighting } from "../normalise/record.ts";
import type { AirframeFacts } from "../identity/facts.ts";
import { SPOT_FIELDS, type SpotField, type SpotSource, type SpotValues } from "../spot/entry.ts";
import { storedFields } from "../agent/check.ts";
import type { ImportIssue, ParsedSource, SightingCandidate } from "./candidate.ts";

export const INBOX_SCHEMA = "touchdown-inbox";
export const INBOX_VERSION = 1;
const MAX_SIGHTINGS = 5000;

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

export interface InboxFile {
  schema: typeof INBOX_SCHEMA;
  version: typeof INBOX_VERSION;
  createdAt: string;
  checker: "claude" | "codex" | null;
  sightings: InboxSighting[];
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
  if (f.version !== INBOX_VERSION) return { error: "an inbox file from another version of Touchdown" };
  if (f.checker !== null && f.checker !== "claude" && f.checker !== "codex") return { error: "unknown checker" };
  if (!Array.isArray(f.sightings) || f.sightings.length > MAX_SIGHTINGS) return { error: `no sightings, or more than ${MAX_SIGHTINGS}` };
  const extra = Object.keys(f).filter((k) => !["schema", "version", "createdAt", "checker", "sightings"].includes(k));
  if (extra.length) return { error: `unexpected keys: ${extra.join(", ")}` };
  const fields = new Set<string>(SPOT_FIELDS);
  const candidates: SightingCandidate[] = [];
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
    candidates.push({ table: "sightings", sourceRow: n, raw, values, issues, external: [], airframeFacts: lookup ? { lookup } : {}, tags: s.tags ?? [], provenance });
  }
  return { source: { format: "touchdown_inbox", fileName, candidates, rowsRead: candidates.length, agentChecker: f.checker ?? null } };
}
