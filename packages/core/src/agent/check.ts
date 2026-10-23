// The agent check (docs/22-agent-verification.md): what the agent is sent, the shape of its answer, the checks
// every answer passes before anyone sees it, and how accepted suggestions change an import's rows. Shared by
// the web app (builds the request, reads the result) and the CLI (runs the agent).

import type { RefIndex } from "../ref/index.ts";
import { PHASES, type FlightValues, type SightingValues } from "../schema/tables.ts";
import { isValidDate } from "../schema/validate.ts";
import type { Candidate, ParsedSource, SourceFormat } from "../import/candidate.ts";
import { normaliseRegistration } from "../normalise/registration.ts";

export const CHECK_REQUEST_SCHEMA = "touchdown-check-request";
export const CHECK_RESULT_SCHEMA = "touchdown-check-result";
export const CHECK_VERSION = 1;
/** Records per agent call. */
export const CHECK_BATCH_SIZE = 50;
/** Records in one request at most. */
export const CHECK_MAX_RECORDS = 5000;

export const AGENT_FIELDS = {
  sighting: ["date", "airport", "registration", "typeCode", "model", "operator", "livery", "specialLivery", "phase"],
  flight: ["date", "flightNumber", "airline", "from", "to", "registration", "typeCode", "model", "livery", "specialLivery"],
} as const;
/** A field a suggestion can name: the record's fields, and the notes of a line typed in a spotting session. */
export type AgentField = (typeof AGENT_FIELDS)[keyof typeof AGENT_FIELDS][number] | "notes";
const ALL_FIELDS = [...new Set([...AGENT_FIELDS.sighting, ...AGENT_FIELDS.flight, "notes"])] as AgentField[];

export const DEFAULT_AGENT_RULES = ["The aircraft type is not standard. Please use a standard one (like the one on flightradar24)."];

export type Verdict = "ok" | "suspect" | "wrong";
export type Confidence = "low" | "medium" | "high";
export type Basis = "reference_data" | "lookup_data" | "consistency" | "model_knowledge" | "typed";
export type Checker = "claude" | "codex";

/** One row as the agent sees it: only what verification needs (no ticket numbers, booking references, seats, photo links). */
export interface CheckRecord {
  recordId: string; // "row-12": the row in the file, so a result fits the same file read again
  kind: "sighting" | "flight";
  fields: Partial<Record<AgentField, string>>;
  /** What the file said where it differs from `fields` ("737" for B737). */
  asTyped: Partial<Record<AgentField, string>>;
  findings: string[]; // the deterministic checks' messages for this row
  notes?: string; // only when the user chose to send notes
  /** Spotting sessions: the words of the user's line that Touchdown could not place in a field. */
  text?: string;
  /** Spotting sessions: what lookups say about the registration. */
  evidence?: AgentEvidence[];
}

/** What one source says about a record's registration, as the agent sees it. */
export interface AgentEvidence {
  source: string; // "your_log", "opensky", "adsbdb", "fr24"
  typeCode: string | null;
  model: string | null;
  operator: string | null;
  /** The day the source describes the aircraft as of. */
  asOf: string | null;
  note: string | null;
}

export interface CheckRequest {
  schema: typeof CHECK_REQUEST_SCHEMA;
  version: typeof CHECK_VERSION;
  batchId: string;
  createdAt: string;
  format: SourceFormat;
  rules: string[];
  records: CheckRecord[];
}

export interface AgentSuggestion {
  field: AgentField;
  current: string;
  suggested: string;
  confidence: Confidence;
  basis: Basis;
  reason: string;
}

export interface AgentRecordResult {
  recordId: string;
  verdict: Verdict;
  note: string;
  suggestions: AgentSuggestion[];
}

export interface RejectedAnswer {
  recordId: string;
  field: string;
  suggested: string;
  why: string;
}

/** What `touchdown check` writes and the Import page reads. Records the agent found nothing wrong with are left out. */
export interface CheckResultFile {
  schema: typeof CHECK_RESULT_SCHEMA;
  version: typeof CHECK_VERSION;
  batchId: string;
  checker: Checker;
  checkerVersion: string;
  model: string | null;
  checkedAt: string;
  checked: number; // records the agent answered for
  records: AgentRecordResult[];
  rejected: RejectedAnswer[];
  failed: { recordIds: string[]; why: string }[]; // batches that got no valid answer
}

// ---------- the request ----------

/** A batch id from the file's bytes, so the same file read again gets the same id. */
export async function checkBatchId(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return "chk-" + [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

function airportText(id: string | null | undefined, raw: string | null | undefined, ref: RefIndex): string | null {
  const a = ref.airport(id);
  return a ? (a.iata ?? a.icao ?? a.id) : str(raw);
}

function operatorText(id: string | null | undefined, raw: string | null | undefined, ref: RefIndex): string | null {
  const o = ref.operator(id);
  return o ? (o.icao ?? o.iata ?? o.name) : str(raw);
}

/** The fields of a row, as Touchdown reads them now, keyed by agent field. */
export function recordFields(c: Candidate, ref: RefIndex): Partial<Record<AgentField, string>> {
  const out: Partial<Record<AgentField, string>> = {};
  const put = (k: AgentField, v: string | null) => {
    if (v) out[k] = v;
  };
  if (c.table === "sightings") {
    const v = c.values;
    put("date", str(v.seenOn));
    put("airport", airportText(v.airportId, v.airportRaw, ref));
    put("registration", str(v.registration ?? v.registrationRaw));
    put("typeCode", str(v.typeCode ?? v.typeCodeRaw));
    put("model", str(v.model ?? v.modelRaw));
    put("operator", operatorText(v.operatorId, v.operatorRaw, ref));
    put("livery", str(v.livery));
    put("specialLivery", str(v.specialLivery));
    put("phase", str(v.phase));
  } else {
    const v = c.values;
    put("date", str(v.scheduledDate));
    put("flightNumber", str(v.flightNumber));
    put("airline", operatorText(v.airlineId, v.airlineRaw, ref));
    put("from", airportText(v.fromAirportId, v.fromRaw, ref));
    put("to", airportText(v.divertedToAirportId ?? v.toAirportId, v.toRaw, ref));
    put("registration", str(v.registration ?? v.registrationRaw));
    put("typeCode", str(v.typeCode ?? v.typeCodeRaw));
    put("model", str(v.model ?? v.modelRaw));
    put("livery", str(v.livery));
    put("specialLivery", str(v.specialLivery));
  }
  return out;
}

function asTyped(c: Candidate, fields: Partial<Record<AgentField, string>>): Partial<Record<AgentField, string>> {
  const v = c.values as Record<string, unknown>;
  const raw: [AgentField, unknown][] =
    c.table === "sightings"
      ? [["registration", v.registrationRaw], ["typeCode", v.typeCodeRaw], ["model", v.modelRaw], ["operator", v.operatorRaw], ["airport", v.airportRaw]]
      : [["registration", v.registrationRaw], ["typeCode", v.typeCodeRaw], ["model", v.modelRaw], ["airline", v.airlineRaw], ["from", v.fromRaw], ["to", v.toRaw]];
  const out: Partial<Record<AgentField, string>> = {};
  for (const [k, r] of raw) {
    const s = str(r);
    if (s && s !== fields[k]) out[k] = s;
  }
  return out;
}

export const recordIdOf = (c: Candidate) => `row-${c.sourceRow}`;

/**
 * The request for one parsed file. `findings` are the deterministic checks' messages per candidate index.
 * Notes go only when `includeNotes` is set; private fields never do.
 */
export function buildCheckRequest(
  source: ParsedSource,
  ref: RefIndex,
  opts: { batchId: string; findings?: Map<number, string[]>; rules?: string[]; includeNotes?: boolean; now?: Date },
): CheckRequest {
  const records = source.candidates.slice(0, CHECK_MAX_RECORDS).map((c, i): CheckRecord => {
    const fields = recordFields(c, ref);
    const findings = [...new Set([...c.issues.filter((x) => x.severity !== "info").map((x) => x.message), ...(opts.findings?.get(i) ?? [])])];
    const rec: CheckRecord = { recordId: recordIdOf(c), kind: c.table === "sightings" ? "sighting" : "flight", fields, asTyped: asTyped(c, fields), findings };
    const notes = str((c.values as { notes?: string | null }).notes);
    if (opts.includeNotes && notes) rec.notes = notes;
    return rec;
  });
  return {
    schema: CHECK_REQUEST_SCHEMA,
    version: CHECK_VERSION,
    batchId: opts.batchId,
    createdAt: (opts.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z"),
    format: source.format,
    rules: (opts.rules ?? DEFAULT_AGENT_RULES).map((r) => r.trim()).filter(Boolean),
    records,
  };
}

/** Checks a request read from a file before anything is sent: its shape, its size, and that it carries nothing extra. */
export function readCheckRequest(json: unknown): { request: CheckRequest } | { error: string } {
  const r = json as Partial<CheckRequest> | null;
  if (!r || typeof r !== "object") return { error: "not a JSON object" };
  if (r.schema !== CHECK_REQUEST_SCHEMA || r.version !== CHECK_VERSION) return { error: "not a Touchdown check request (or one from another version)" };
  if (typeof r.batchId !== "string" || !/^chk-[0-9a-f]{16}$/.test(r.batchId)) return { error: "missing or malformed batch id" };
  if (!Array.isArray(r.records) || !r.records.length) return { error: "no records" };
  if (r.records.length > CHECK_MAX_RECORDS) return { error: `more than ${CHECK_MAX_RECORDS} records` };
  if (!Array.isArray(r.rules) || r.rules.some((x) => typeof x !== "string" || x.length > 500) || r.rules.length > 50) return { error: "malformed rules" };
  const extra = Object.keys(r).filter((k) => !["schema", "version", "batchId", "createdAt", "format", "rules", "records"].includes(k));
  if (extra.length) return { error: `unexpected keys: ${extra.join(", ")}` };
  const ids = new Set<string>();
  for (const rec of r.records as CheckRecord[]) {
    if (!rec || typeof rec.recordId !== "string" || !/^row-\d{1,6}$/.test(rec.recordId) || ids.has(rec.recordId)) return { error: "malformed or repeated record id" };
    ids.add(rec.recordId);
    if (rec.kind !== "sighting" && rec.kind !== "flight") return { error: `${rec.recordId}: unknown kind` };
    const allowed = new Set<string>(AGENT_FIELDS[rec.kind]);
    for (const part of [rec.fields, rec.asTyped]) {
      if (!part || typeof part !== "object") return { error: `${rec.recordId}: malformed fields` };
      for (const [k, v] of Object.entries(part)) if (!allowed.has(k) || typeof v !== "string" || v.length > 200) return { error: `${rec.recordId}: field ${k} is not allowed` };
    }
    if (!Array.isArray(rec.findings) || rec.findings.some((x) => typeof x !== "string" || x.length > 500)) return { error: `${rec.recordId}: malformed findings` };
    if (rec.notes !== undefined && (typeof rec.notes !== "string" || rec.notes.length > 500)) return { error: `${rec.recordId}: malformed notes` };
    const keys = Object.keys(rec).filter((k) => !["recordId", "kind", "fields", "asTyped", "findings", "notes"].includes(k));
    if (keys.length) return { error: `${rec.recordId}: unexpected keys ${keys.join(", ")}` };
  }
  return { request: r as CheckRequest };
}

// ---------- what each agent call sees ----------

export interface AgentPayload {
  rules: string[];
  records: CheckRecord[];
  reference: {
    types: { designator: string; name: string; family: string | null; models: string[] }[];
    operators: { icao: string | null; iata: string | null; name: string }[];
    airports: { iata: string | null; icao: string | null; name: string }[];
  };
}

/**
 * The batch with the slice of reference data it needs: every type in the families of the types and models
 * named (so the agent can pick a valid designator), with example model names, and the operators and airports named.
 */
export function agentPayload(records: CheckRecord[], rules: string[], ref: RefIndex): AgentPayload {
  const designators = new Set<string>();
  const families = new Set<string>();
  const ops = new Map<string, AgentPayload["reference"]["operators"][number]>();
  const aps = new Map<string, AgentPayload["reference"]["airports"][number]>();
  for (const r of records) {
    const told = (r.evidence ?? []).map((e) => ({ typeCode: e.typeCode ?? undefined, model: e.model ?? undefined, operator: e.operator ?? undefined }));
    for (const part of [r.fields, r.asTyped, ...told] as Partial<Record<AgentField, string>>[]) {
      const t = part.typeCode?.toUpperCase();
      if (t && ref.type(t)) designators.add(t);
      if (part.model) for (const d of ref.typesForModel(part.model.toUpperCase())) designators.add(d);
      for (const code of [part.operator, part.airline]) {
        const o = ref.operatorByCode(code);
        if (o) ops.set(o.id, { icao: o.icao, iata: o.iata, name: o.name });
      }
      for (const code of [part.airport, part.from, part.to]) {
        const a = ref.airportByCode(code);
        if (a) aps.set(a.id, { iata: a.iata, icao: a.icao, name: a.name });
      }
    }
  }
  for (const d of designators) {
    const f = ref.familyIdOf(d);
    if (f) families.add(f);
  }
  for (const t of ref.types.values()) {
    const f = ref.familyIdOf(t.designator);
    if (f && families.has(f)) designators.add(t.designator);
  }
  const types = [...designators].sort().map((d) => {
    const t = ref.type(d)!;
    return { designator: d, name: `${t.manufacturer} ${t.name}`, family: ref.family(ref.familyIdOf(d))?.name ?? null, models: ref.modelExamples(d).slice(0, 3) };
  });
  return { rules, records, reference: { types, operators: [...ops.values()], airports: [...aps.values()] } };
}

/** JSON Schema of an agent's answer. Strict: every property required, nothing extra, enums where possible. */
export const AGENT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["records"],
  properties: {
    records: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["recordId", "verdict", "note", "suggestions"],
        properties: {
          recordId: { type: "string" },
          verdict: { type: "string", enum: ["ok", "suspect", "wrong"] },
          note: { type: "string" },
          suggestions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["field", "current", "suggested", "confidence", "basis", "reason"],
              properties: {
                field: { type: "string", enum: ALL_FIELDS },
                current: { type: "string" },
                suggested: { type: "string" },
                confidence: { type: "string", enum: ["low", "medium", "high"] },
                basis: { type: "string", enum: ["reference_data", "lookup_data", "consistency", "model_knowledge", "typed"] },
                reason: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
} as const;

// ---------- checking an answer ----------

const VERDICTS = new Set(["ok", "suspect", "wrong"]);
const CONFIDENCES = new Set(["low", "medium", "high"]);
const BASES = new Set(["reference_data", "lookup_data", "consistency", "model_knowledge", "typed"]);
const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/**
 * Why a suggested value cannot be used, or null when it passes the field's format rule (docs/20). Values are
 * compared in their stored form: a type code must exist, an operator or airport code must resolve, and so on.
 */
export function suggestionProblem(field: AgentField, value: string, ref: RefIndex, today?: string): string | null {
  const v = value.trim();
  switch (field) {
    case "typeCode":
      return ref.type(v) ? null : `"${v}" is not a known ICAO type designator`;
    case "registration": {
      const n = normaliseRegistration(v, ref);
      return n?.knownFormat ? null : `"${v}" does not match any country's registration format`;
    }
    case "operator":
    case "airline":
      return /^[A-Z0-9]{2,3}$/i.test(v) && ref.operatorByCode(v) ? null : `"${v}" is not a known airline code`;
    case "airport":
    case "from":
    case "to":
      return ref.airportByCode(v) ? null : `"${v}" is not a known airport code`;
    case "date":
      return isValidDate(v) && (!today || v <= today) ? null : `"${v}" is not a valid date`;
    case "flightNumber":
      return /^[A-Z0-9]{2}[A-Z]?\d{1,4}[A-Z]?$/.test(v.toUpperCase().replace(/\s+/g, "")) ? null : `"${v}" is not a flight number`;
    case "phase":
      return (PHASES as readonly string[]).includes(v) ? null : `"${v}" is not a phase`;
    case "model":
      return v && v.length <= 60 ? null : "the model is empty or too long";
    case "livery":
    case "specialLivery":
      return v.length <= 80 ? null : "too long";
    case "notes":
      return v.length <= 500 ? null : "too long";
  }
}

/**
 * Keeps the parts of an agent's answer that pass: records that were in the batch, fields allowed for their kind,
 * values in the field's format and different from the current one. Everything else is reported as rejected.
 */
export function checkAgentAnswer(answer: unknown, records: CheckRecord[], ref: RefIndex, today?: string): { records: AgentRecordResult[]; rejected: RejectedAnswer[] } | { error: string } {
  const a = answer as { records?: unknown } | null;
  if (!a || typeof a !== "object" || !Array.isArray(a.records)) return { error: "the answer has no records list" };
  const byId = new Map(records.map((r) => [r.recordId, r]));
  const out: AgentRecordResult[] = [];
  const rejected: RejectedAnswer[] = [];
  const seen = new Set<string>();
  for (const raw of a.records as Record<string, unknown>[]) {
    const id = String(raw?.recordId ?? "");
    const rec = byId.get(id);
    if (!rec || seen.has(id)) {
      rejected.push({ recordId: clip(id, 40), field: "", suggested: "", why: rec ? "answered twice" : "not a record in this batch" });
      continue;
    }
    seen.add(id);
    const verdict = VERDICTS.has(String(raw.verdict)) ? (raw.verdict as Verdict) : "suspect";
    // Notes only for a typed line, where the agent sorts the user's words into fields and leaves the rest as notes.
    const allowed = new Set<string>([...AGENT_FIELDS[rec.kind], ...(rec.text !== undefined ? ["notes"] : [])]);
    const suggestions: AgentSuggestion[] = [];
    for (const s of Array.isArray(raw.suggestions) ? (raw.suggestions as Record<string, unknown>[]) : []) {
      const field = String(s?.field ?? "");
      const suggested = clip(s?.suggested, 120);
      const why = !allowed.has(field)
        ? `${field || "a field"} cannot be suggested for a ${rec.kind}`
        : !CONFIDENCES.has(String(s.confidence)) || !BASES.has(String(s.basis))
          ? "malformed suggestion"
          : suggestionProblem(field as AgentField, suggested, ref, today);
      if (why) {
        rejected.push({ recordId: id, field, suggested, why });
        continue;
      }
      const current = rec.fields[field as AgentField] ?? "";
      if (sameValue(field as AgentField, current, suggested, ref)) continue;
      if (suggestions.some((x) => x.field === field)) {
        rejected.push({ recordId: id, field, suggested, why: "a second suggestion for the same field" });
        continue;
      }
      suggestions.push({ field: field as AgentField, current, suggested, confidence: s.confidence as Confidence, basis: s.basis as Basis, reason: clip(s.reason, 200) });
    }
    // Nothing to show: no suggestion survived and there is no note.
    const note = clip(raw.note, 200);
    if (!suggestions.length && (!note || verdict === "ok")) continue;
    out.push({ recordId: id, verdict, note, suggestions });
  }
  return { records: out, rejected };
}

function sameValue(field: AgentField, a: string, b: string, ref: RefIndex): boolean {
  if (field === "registration") return normaliseRegistration(a, ref)?.match === normaliseRegistration(b, ref)?.match;
  if (field === "operator" || field === "airline") return !!a && ref.operatorByCode(a)?.id === ref.operatorByCode(b)?.id;
  if (field === "airport" || field === "from" || field === "to") return !!a && ref.airportByCode(a)?.id === ref.airportByCode(b)?.id;
  // How a livery or a model is written is the point of a suggestion; codes are stored upper case anyway.
  if (field === "livery" || field === "specialLivery" || field === "model" || field === "notes") return a.trim() === b.trim();
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Checks a result file against the rows of the file now being imported, and checks every suggestion again. */
export function readCheckResult(json: unknown, request: CheckRequest, ref: RefIndex): { result: CheckResultFile; dropped: number } | { error: string } {
  const r = json as Partial<CheckResultFile> | null;
  if (!r || typeof r !== "object" || r.schema !== CHECK_RESULT_SCHEMA || r.version !== CHECK_VERSION) return { error: "This is not a Touchdown check result." };
  if (r.batchId !== request.batchId) return { error: "This result is for another file. Check the file you are importing, or import the file the result was made for." };
  if (r.checker !== "claude" && r.checker !== "codex") return { error: "The result does not say which agent made it." };
  const checked = checkAgentAnswer({ records: r.records ?? [] }, request.records, ref);
  if ("error" in checked) return { error: `The result is malformed: ${checked.error}.` };
  const before = (r.records ?? []).reduce((n, x) => n + (Array.isArray(x?.suggestions) ? x.suggestions.length : 0), 0);
  const after = checked.records.reduce((n, x) => n + x.suggestions.length, 0);
  return {
    result: {
      schema: CHECK_RESULT_SCHEMA,
      version: CHECK_VERSION,
      batchId: r.batchId,
      checker: r.checker,
      checkerVersion: clip(r.checkerVersion, 40),
      model: r.model ? clip(r.model, 60) : null,
      checkedAt: clip(r.checkedAt, 40),
      checked: Number(r.checked) || 0,
      records: checked.records,
      rejected: Array.isArray(r.rejected) ? r.rejected.slice(0, 500).map((x) => ({ recordId: clip(x.recordId, 40), field: clip(x.field, 40), suggested: clip(x.suggested, 120), why: clip(x.why, 200) })) : [],
      failed: Array.isArray(r.failed) ? r.failed.slice(0, 200).map((x) => ({ recordIds: Array.isArray(x.recordIds) ? x.recordIds.map((y) => clip(y, 40)).slice(0, CHECK_BATCH_SIZE) : [], why: clip(x.why, 200) })) : [],
    },
    dropped: before - after,
  };
}

// ---------- using accepted suggestions ----------

/** The stored fields an accepted suggestion changes, for its provenance rows. */
export function storedFields(kind: "sighting" | "flight", field: AgentField): string[] {
  switch (field) {
    case "date":
      return [kind === "sighting" ? "seenOn" : "scheduledDate"];
    case "operator":
      return ["operatorId"];
    case "airline":
      return ["airlineId"];
    case "airport":
      return ["airportId"];
    case "from":
      return ["fromAirportId"];
    case "to":
      return ["toAirportId"];
    default:
      return [field];
  }
}

/** The values a suggestion sets on a row; null when it no longer applies. The value as typed stays in its raw field. */
export function suggestionPatch(c: Candidate, s: Pick<AgentSuggestion, "field" | "suggested">, ref: RefIndex): Record<string, unknown> | null {
  const v = s.suggested.trim();
  if (suggestionProblem(s.field, v, ref)) return null;
  const sighting = c.table === "sightings";
  switch (s.field) {
    case "typeCode":
      return { typeCode: v.toUpperCase() };
    case "model":
      return { model: v };
    case "registration":
      return { registration: normaliseRegistration(v, ref)!.display };
    case "operator":
      return sighting ? { operatorId: ref.operatorByCode(v, (c.values as Partial<SightingValues>).seenOn)!.id } : null;
    case "airline":
      return sighting ? null : { airlineId: ref.operatorByCode(v, (c.values as Partial<FlightValues>).scheduledDate)!.id };
    case "airport":
      return sighting ? { airportId: ref.airportByCode(v)!.id } : null;
    case "from":
      return sighting ? null : { fromAirportId: ref.airportByCode(v)!.id };
    case "to":
      return sighting ? null : { toAirportId: ref.airportByCode(v)!.id };
    case "date":
      return sighting ? { seenOn: v } : { scheduledDate: v };
    case "flightNumber":
      return sighting ? null : { flightNumber: v.toUpperCase().replace(/\s+/g, "") };
    case "phase":
      return sighting ? { phase: v } : null;
    case "livery":
      return { livery: v || null };
    case "specialLivery":
      return { specialLivery: v || null };
    case "notes":
      return { notes: v || null };
  }
}

/**
 * The file's rows with the accepted suggestions applied, keyed by record id. Rows are copied, so the parsed
 * file stays as it was and a suggestion can be taken back.
 */
export function applySuggestions(source: ParsedSource, accepted: Map<string, AgentSuggestion[]>, ref: RefIndex): ParsedSource {
  if (!accepted.size) return source;
  const candidates = source.candidates.map((c) => {
    const list = accepted.get(recordIdOf(c));
    if (!list?.length) return c;
    const values = { ...c.values } as Record<string, unknown>;
    for (const s of list) Object.assign(values, suggestionPatch(c, s, ref) ?? {});
    return { ...c, values } as Candidate;
  });
  return { ...source, candidates };
}
