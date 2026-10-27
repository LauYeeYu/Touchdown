// Changes to what is in the log already, made on the command line and imported only after a review (docs/34,
// "Change files"): edits, deletions, aircraft facts and merges, accepted and reopened findings, suggested fixes,
// undone imports, family choices, settings, saved Statistics views, facts looked up for an aircraft and a flight's
// recorded track, added, replaced or removed. They travel in an inbox file (version 3) and are applied with the
// same code as the web app's own changes (edit.ts), as one import batch that can be undone like any other.

import { flightDay } from "../derive.ts";
import { acceptFinding, applyFix, deleteRecord, mergeAirframes, removeView, reopenFinding, saveFlight, saveSighting, saveView, setFamily, tagsOf, updateAirframe, updateSettings, type EditOptions, type SavedView } from "../edit.ts";
import { DIMENSIONS } from "../stats/index.ts";
import { resolveAirframes } from "../identity/resolve.ts";
import { airframeFactsEffect, applyAirframeFacts, type AirframeFacts } from "../identity/facts.ts";
import { normaliseAircraft } from "../normalise/record.ts";
import type { RefIndex } from "../ref/index.ts";
import { checkAll } from "../rules/check.ts";
import { RULES, type Finding } from "../rules/types.ts";
import { AIRFRAME_STATUSES, CABIN_CLASSES, FLIGHT_REASONS, PHASES, SEAT_POSITIONS, TABLES, TRACK_PROVIDERS, type Flight, type Row, type Settings, type Sighting, type TableName } from "../schema/tables.ts";
import { isValidDate, isValidDateTime } from "../schema/validate.ts";
import { Store, type Change } from "../store.ts";
import { parseDateTime, toUtcIso, zonedDateTime } from "../time/index.ts";
import { phaseOf, readMapped, type ColumnField } from "./mapping.ts";
import { buildFlightTimes } from "./times.ts";
import { phasesOf, setPhases } from "../phases.ts";
import { undoImport } from "./pipeline.ts";
import { attachTrack, MAX_TRACK_POINTS, removeTrack, simplifyTrack, trackDistanceKm, type TrackFile, type TrackPointInput } from "../tracks.ts";

export type RecordTable = "flights" | "sightings";

/** Settings the log keeps for every device (the theme belongs to each browser). */
export type LogSettings = Partial<Pick<Settings, "codeDisplay" | "distanceUnit" | "modelNaming">>;

export type InboxChange =
  | { op: "edit"; table: RecordTable; id: string; rev: number; set: Record<string, string | number | boolean | null>; clear: string[]; tags?: string[]; phases?: string[] }
  | { op: "delete"; table: RecordTable; id: string; rev: number }
  | { op: "airframe"; id: string; rev: number; set: Record<string, string | null>; clear: string[] }
  | { op: "merge"; into: string; from: string }
  | { op: "accept"; ruleId: string; fingerprint: string; note: string | null }
  | { op: "reopen"; ackId: string }
  | { op: "fix"; ruleId: string; fingerprint: string; fix: number }
  | { op: "undo"; batchId: string; force?: boolean }
  | { op: "family"; designator: string; familyId: string | null }
  | { op: "settings"; set: LogSettings }
  | ({ op: "view" } & SavedView)
  | { op: "removeView"; id: string }
  /** Facts a lookup found for an aircraft (`touchdown airframes`), checked against its records again when imported. */
  | { op: "facts"; id: string; facts: AirframeFacts; overwriteImported?: boolean }
  | { op: "track"; flightId: string; provider: (typeof TRACK_PROVIDERS)[number]; attribution: string; coverage: "complete" | "partial"; distanceKm: number; points: TrackPointTuple[] }
  | { op: "removeTrack"; flightId: string };

/** A track point in a change file: Unix seconds, latitude, longitude, altitude (ft), ground speed (kt), heading. */
export type TrackPointTuple = [number, number, number, number | null, number | null, number | null];

export const trackTuple = (p: TrackPointInput): TrackPointTuple => [p.t, p.lat, p.lon, p.altitudeFt, p.groundSpeedKt, p.headingDeg];
export const tuplePoint = ([t, lat, lon, altitudeFt, groundSpeedKt, headingDeg]: TrackPointTuple): TrackPointInput => ({ t, lat, lon, altitudeFt, groundSpeedKt, headingDeg });

/** The change that gives a flight a track read from a file: at most MAX_TRACK_POINTS points, the distance along all of them. */
export function trackChangeFor(flightId: string, file: TrackFile, coverage: "complete" | "partial"): Extract<InboxChange, { op: "track" }> {
  return { op: "track", flightId, provider: file.provider, attribution: file.attribution, coverage, distanceKm: Math.round(trackDistanceKm(file.points) * 10) / 10, points: simplifyTrack(file.points).map(trackTuple) };
}

const optionalNumber = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));

/** Why a change file's track points cannot be read, or null. */
function trackPointsProblem(points: unknown): string | null {
  if (!Array.isArray(points) || points.length < 2 || points.length > MAX_TRACK_POINTS) return `points is a list of 2 to ${MAX_TRACK_POINTS} points`;
  let previous = -Infinity;
  for (const p of points) {
    if (!Array.isArray(p) || p.length !== 6) return "malformed point";
    const [t, lat, lon, ...rest] = p as unknown[];
    if (!Number.isInteger(t) || (t as number) <= previous) return "points are not in time order";
    if (typeof lat !== "number" || typeof lon !== "number" || Math.abs(lat) > 90 || Math.abs(lon) > 180) return "malformed position";
    if (!rest.every(optionalNumber)) return "malformed altitude, speed or heading";
    previous = t as number;
  }
  return null;
}

export type ChangeOp = InboxChange["op"];
export const CHANGE_OPS: readonly ChangeOp[] = ["edit", "delete", "airframe", "merge", "accept", "reopen", "fix", "undo", "family", "settings", "view", "removeView", "facts", "track", "removeTrack"];

const text = (v: unknown, max: number) => v === null || (typeof v === "string" && v.length <= max);
const dateOrNull = (v: unknown) => v === null || v === undefined || (typeof v === "string" && isValidDate(v));

/** What is wrong with looked-up facts in a change file, or null. */
function factsProblem(f: Record<string, unknown> | null): string | null {
  if (!f || typeof f !== "object" || Array.isArray(f)) return "facts is not an object";
  const allowed = ["provider", "url", "fetchedAt", "registration", "manufacturer", "msn", "lineNumber", "typeText", "typeCode", "firstFlightDate", "deliveryDate", "status", "notBefore", "notBeforeLabel", "registrations", "icaoHex"];
  const extra = Object.keys(f).filter((k) => !allowed.includes(k));
  if (extra.length) return `unexpected keys in facts: ${extra.join(", ")}`;
  if (typeof f.provider !== "string" || !/^[a-z0-9_]{1,30}$/.test(f.provider)) return "malformed provider";
  if (!(f.url === null || (typeof f.url === "string" && /^https:\/\/[^\s]{1,500}$/.test(f.url)))) return "malformed address";
  if (typeof f.fetchedAt !== "string" || !isValidDateTime(f.fetchedAt)) return "malformed time of the lookup";
  if (typeof f.registration !== "string" || !f.registration || f.registration.length > 20) return "malformed registration";
  for (const k of ["manufacturer", "msn", "lineNumber", "typeText", "typeCode"]) if (!text(f[k], 200)) return `malformed ${k}`;
  for (const k of ["firstFlightDate", "deliveryDate", "notBefore"]) if (!dateOrNull(f[k])) return `${k} is not a date`;
  if (!(f.notBeforeLabel === undefined || text(f.notBeforeLabel, 200))) return "malformed notBeforeLabel";
  if (!(f.status === null || (AIRFRAME_STATUSES as readonly unknown[]).includes(f.status))) return "unknown status";
  if (!(f.icaoHex === undefined || f.icaoHex === null || (typeof f.icaoHex === "string" && /^[0-9a-fA-F]{6}$/.test(f.icaoHex)))) return "malformed transponder address";
  const regs = f.registrations;
  if (!Array.isArray(regs) || regs.length > 50) return "malformed registrations";
  for (const r of regs as Record<string, unknown>[]) {
    if (!r || typeof r !== "object" || Object.keys(r).some((k) => !["registration", "from", "to", "operator"].includes(k))) return "malformed registrations";
    if (typeof r.registration !== "string" || r.registration.length > 20 || !dateOrNull(r.from) || !dateOrNull(r.to) || !text(r.operator ?? null, 200)) return "malformed registrations";
  }
  return null;
}

const MEASURES = ["records", "aircraft", "distance", "time"] as const;

/** What is wrong with a view, or null: dimensions of its dataset, two different ones, distance and time for flights. */
export function viewProblem(v: { dataset: unknown; rowDimension: unknown; columnDimension: unknown; measure: unknown }): string | null {
  if (v.dataset !== "flights" && v.dataset !== "sightings") return "a view counts flights or sightings";
  const dim = (id: unknown) => DIMENSIONS.find((d) => d.id === id);
  const row = dim(v.rowDimension);
  if (!row) return `${String(v.rowDimension)} is not a dimension`;
  if (!row.datasets.includes(v.dataset)) return `${row.id} is for ${row.datasets.join(" and ")}, not ${v.dataset}`;
  if (v.columnDimension !== null) {
    const col = dim(v.columnDimension);
    if (!col) return `${String(v.columnDimension)} is not a dimension`;
    if (!col.datasets.includes(v.dataset)) return `${col.id} is for ${col.datasets.join(" and ")}, not ${v.dataset}`;
    if (col.id === row.id) return "the rows and the columns need two different dimensions";
  }
  if (!(MEASURES as readonly unknown[]).includes(v.measure)) return `the count is one of ${MEASURES.join(", ")}`;
  if (v.dataset === "sightings" && (v.measure === "distance" || v.measure === "time")) return "distance and time are measured for flights only";
  return null;
}

const NOT_EDITABLE = new Set(["airframeId", "sourceKind", "sourceBatchId", "sourceRow"]);
const columnsOf = (t: RecordTable) => new Set(TABLES[t].columns.map((c) => c.name).filter((n) => !NOT_EDITABLE.has(n)));

/** The stored fields a change may set: every field of a flight or sighting but its links and its import. */
export const EDITABLE: Record<RecordTable | "airframes", Set<string>> = {
  flights: columnsOf("flights"),
  sightings: columnsOf("sightings"),
  airframes: new Set(["manufacturer", "msn", "lineNumber", "typeCode", "model", "firstFlightDate", "deliveryDate", "status", "notes"]),
};

const SETTING_VALUES: Record<keyof LogSettings, readonly string[]> = {
  codeDisplay: ["iata", "icao", "both"],
  distanceUnit: ["km", "mi", "nm"],
  modelNaming: ["standard", "compact"],
};

const MAX_CHANGES = 5000;
const ID_RE = /^[A-Za-z0-9_:.|-]{1,80}$/;
const TAG_RE = /^[a-z_]{1,40}$/;

const isId = (v: unknown): v is string => typeof v === "string" && ID_RE.test(v);
const isRev = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isValue = (v: unknown) => v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= 2000);

/** Checks the changes of an inbox file. */
export function readChanges(list: unknown): { changes: InboxChange[] } | { error: string } {
  if (!Array.isArray(list)) return { error: "malformed: changes is not a list" };
  if (list.length > MAX_CHANGES) return { error: `more than ${MAX_CHANGES} changes` };
  const out: InboxChange[] = [];
  for (const [i, raw] of list.entries()) {
    const n = i + 1;
    const c = raw as Record<string, unknown> | null;
    if (!c || typeof c !== "object" || !CHANGE_OPS.includes(c.op as ChangeOp)) return { error: `change ${n} is malformed` };
    const keys = (allowed: string[]) => Object.keys(c).filter((k) => k !== "op" && !allowed.includes(k));
    const bad = (why: string) => ({ error: `change ${n} (${String(c.op)}): ${why}` });
    switch (c.op) {
      case "edit":
      case "delete": {
        if (keys(c.op === "edit" ? ["table", "id", "rev", "set", "clear", "tags", "phases"] : ["table", "id", "rev"]).length) return bad("unexpected keys");
        if (c.table !== "flights" && c.table !== "sightings") return bad("table is flights or sightings");
        if (!isId(c.id) || !isRev(c.rev)) return bad("malformed id or rev");
        if (c.op === "delete") break;
        const set = c.set as Record<string, unknown>;
        if (!set || typeof set !== "object" || Array.isArray(set)) return bad("set is not an object");
        const fields = EDITABLE[c.table];
        for (const [k, v] of Object.entries(set)) if (!fields.has(k) || !isValue(v)) return bad(`field ${k} cannot be set`);
        if (!Array.isArray(c.clear) || c.clear.some((k) => typeof k !== "string" || !fields.has(k))) return bad("malformed clear");
        if (c.tags !== undefined && (c.table !== "sightings" || !Array.isArray(c.tags) || c.tags.length > 20 || c.tags.some((t) => typeof t !== "string" || !TAG_RE.test(t)))) return bad("malformed tags");
        if (c.phases !== undefined && (c.table !== "sightings" || !Array.isArray(c.phases) || c.phases.some((p) => !(PHASES as readonly unknown[]).includes(p)))) return bad("malformed phases");
        break;
      }
      case "airframe": {
        if (keys(["id", "rev", "set", "clear"]).length) return bad("unexpected keys");
        if (!isId(c.id) || !isRev(c.rev)) return bad("malformed id or rev");
        const set = c.set as Record<string, unknown>;
        if (!set || typeof set !== "object") return bad("set is not an object");
        for (const [k, v] of Object.entries(set)) if (!EDITABLE.airframes.has(k) || !(v === null || (typeof v === "string" && v.length <= 300))) return bad(`field ${k} cannot be set`);
        if (!Array.isArray(c.clear) || c.clear.some((k) => typeof k !== "string" || !EDITABLE.airframes.has(k))) return bad("malformed clear");
        break;
      }
      case "merge":
        if (keys(["into", "from"]).length || !isId(c.into) || !isId(c.from) || c.into === c.from) return bad("needs two different aircraft");
        break;
      case "accept":
      case "fix":
        if (keys(c.op === "accept" ? ["ruleId", "fingerprint", "note"] : ["ruleId", "fingerprint", "fix"]).length) return bad("unexpected keys");
        if (typeof c.ruleId !== "string" || !RULES[c.ruleId] || typeof c.fingerprint !== "string" || !/^[0-9a-f]{8}$/.test(c.fingerprint)) return bad("unknown finding");
        if (c.op === "accept" && !(c.note === null || (typeof c.note === "string" && c.note.length <= 500))) return bad("malformed note");
        if (c.op === "fix" && !(Number.isInteger(c.fix) && (c.fix as number) >= 0 && (c.fix as number) < 20)) return bad("malformed fix number");
        break;
      case "reopen":
        if (keys(["ackId"]).length || !isId(c.ackId)) return bad("malformed");
        break;
      case "undo":
        if (keys(["batchId", "force"]).length || !isId(c.batchId) || (c.force !== undefined && typeof c.force !== "boolean")) return bad("malformed");
        break;
      case "family":
        if (keys(["designator", "familyId"]).length || typeof c.designator !== "string" || !/^[A-Z0-9]{2,4}$/.test(c.designator) || !(c.familyId === null || isId(c.familyId))) return bad("malformed");
        break;
      case "settings": {
        const set = c.set as Record<string, unknown>;
        if (keys(["set"]).length || !set || typeof set !== "object" || !Object.keys(set).length) return bad("malformed");
        for (const [k, v] of Object.entries(set)) if (!(k in SETTING_VALUES) || !SETTING_VALUES[k as keyof LogSettings].includes(v as string)) return bad(`${k} cannot be ${String(v)}`);
        break;
      }
      case "view": {
        if (keys(["name", "dataset", "rowDimension", "columnDimension", "measure"]).length) return bad("unexpected keys");
        if (typeof c.name !== "string" || !c.name.trim() || c.name.length > 80) return bad("malformed name");
        const problem = viewProblem({ dataset: c.dataset, rowDimension: c.rowDimension, columnDimension: c.columnDimension ?? null, measure: c.measure });
        if (problem) return bad(problem);
        break;
      }
      case "removeView":
        if (keys(["id"]).length || !isId(c.id)) return bad("malformed");
        break;
      case "facts": {
        if (keys(["id", "facts", "overwriteImported"]).length || !isId(c.id) || (c.overwriteImported !== undefined && typeof c.overwriteImported !== "boolean")) return bad("malformed");
        const problem = factsProblem(c.facts as Record<string, unknown> | null);
        if (problem) return bad(problem);
        break;
      }
      case "track": {
        if (keys(["flightId", "provider", "attribution", "coverage", "distanceKm", "points"]).length || !isId(c.flightId)) return bad("malformed");
        if (!(TRACK_PROVIDERS as readonly unknown[]).includes(c.provider) || (c.coverage !== "complete" && c.coverage !== "partial")) return bad("unknown provider or coverage");
        if (typeof c.attribution !== "string" || !c.attribution.trim() || c.attribution.length > 200) return bad("malformed attribution");
        if (typeof c.distanceKm !== "number" || !Number.isFinite(c.distanceKm) || c.distanceKm < 0 || c.distanceKm > 50_000) return bad("malformed distance");
        const problem = trackPointsProblem(c.points);
        if (problem) return bad(problem);
        break;
      }
      case "removeTrack":
        if (keys(["flightId"]).length || !isId(c.flightId)) return bad("malformed");
        break;
    }
    out.push(c as unknown as InboxChange);
  }
  return { changes: out };
}

// ---------- building an edit ----------

/**
 * Fields `touchdown edit` takes for a flight: those `add` takes, read the same way, those the web app's form sets
 * besides, and the airline that flew it and the timetable's departure and arrival, which only this command sets.
 */
export const FLIGHT_EDIT_FIELDS = ["date", "flightNumber", "airline", "operatedBy", "from", "to", "registration", "typeCode", "model", "livery", "specialLivery", "seat", "seatPosition", "class", "cabin", "bookingClass", "fare", "reason", "terminal", "gate", "boarding", "departureScheduled", "takeoff", "landing", "arrivalScheduled", "duration", "notes", "ticketNumber", "bookingRef"] as const;
export const SIGHTING_EDIT_FIELDS = ["date", "time", "airport", "spot", "registration", "airline", "typeCode", "model", "phase", "livery", "specialLivery", "photos", "notes", "tags"] as const;
export const AIRFRAME_EDIT_FIELDS = ["manufacturer", "msn", "lineNumber", "typeCode", "model", "firstFlight", "delivered", "status", "notes"] as const;

/** The stored fields each field of `edit` sets on a flight. */
const FLIGHT_STORED: Record<(typeof FLIGHT_EDIT_FIELDS)[number], string[]> = {
  date: ["scheduledDate"],
  flightNumber: ["flightNumber"],
  airline: ["airlineRaw", "airlineId"],
  operatedBy: ["operatingAirlineId"],
  from: ["fromRaw", "fromAirportId"],
  to: ["toRaw", "toAirportId"],
  registration: ["registrationRaw", "registration"],
  typeCode: ["typeCodeRaw", "typeCode"],
  model: ["modelRaw", "model"],
  livery: ["livery"],
  specialLivery: ["specialLivery"],
  seat: ["seat"],
  seatPosition: ["seatPosition"],
  class: ["cabinClass", "bookingClass", "fareBrand"],
  cabin: ["cabinClass"],
  bookingClass: ["bookingClass"],
  fare: ["fareBrand"],
  reason: ["reason"],
  terminal: ["departureTerminal"],
  gate: ["departureGate"],
  boarding: ["boardingAt"],
  departureScheduled: ["departureScheduledAt"],
  takeoff: ["takeoffAt"],
  landing: ["landingAt"],
  arrivalScheduled: ["arrivalScheduledAt"],
  duration: ["landingAt"],
  notes: ["notes"],
  ticketNumber: ["ticketNumber"],
  bookingRef: ["bookingRef"],
};

/** Read through the column mapping, as `add` reads them; the others are set as given. */
const MAPPED = new Set<string>(["date", "flightNumber", "airline", "from", "to", "registration", "typeCode", "model", "livery", "specialLivery", "seat", "class", "gate", "boarding", "takeoff", "landing", "duration", "notes", "ticketNumber", "bookingRef"]);

const SIGHTING_STORED: Record<(typeof SIGHTING_EDIT_FIELDS)[number], string[]> = {
  date: ["seenOn"],
  time: ["seenAt"],
  airport: ["airportRaw", "airportId"],
  spot: ["spotName"],
  registration: ["registrationRaw", "registration"],
  airline: ["operatorRaw", "operatorId"],
  typeCode: ["typeCodeRaw", "typeCode"],
  model: ["modelRaw", "model"],
  phase: ["phase"],
  livery: ["livery"],
  specialLivery: ["specialLivery"],
  photos: ["photoCount"],
  notes: ["notes"],
  tags: [],
};

const AIRFRAME_STORED: Record<(typeof AIRFRAME_EDIT_FIELDS)[number], string> = {
  manufacturer: "manufacturer",
  msn: "msn",
  lineNumber: "lineNumber",
  typeCode: "typeCode",
  model: "model",
  firstFlight: "firstFlightDate",
  delivered: "deliveryDate",
  status: "status",
  notes: "notes",
};

export type EditInput = Record<string, string | null>;
export type Built<T> = { change: T; notes: string[] } | { error: string };

const enumOf = (values: readonly string[], text: string) => {
  const v = text.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return values.includes(v) ? v : null;
};

/** The local clock time of a stored date-time, "11:40". */
const clockOf = (dt: string | null) => (dt ? (parseDateTime(dt)?.time.slice(0, 5) ?? null) : null);

/** Keep only the fields that differ from the record; what is cleared must have a value now. */
function diff(rec: Record<string, unknown>, set: Record<string, unknown>, clear: string[]) {
  const changed = Object.fromEntries(Object.entries(set).filter(([k, v]) => (rec[k] ?? null) !== (v ?? null)));
  return { set: changed, clear: [...new Set(clear)].filter((k) => !(k in changed) && rec[k] !== null && rec[k] !== undefined) };
}

function unknownFields(input: EditInput, allowed: readonly string[]): string | null {
  const bad = Object.keys(input).filter((k) => !allowed.includes(k));
  return bad.length ? `${bad.join(", ")} ${bad.length === 1 ? "is not a field" : "are not fields"} that can be changed. Fields: ${allowed.join(", ")}.` : null;
}

/** An edit of a flight from fields named as `add` names them; an empty value (or null) clears the field. */
export function flightEdit(store: Store, ref: RefIndex, f: Flight, input: EditInput): Built<Extract<InboxChange, { op: "edit" }>> {
  const unknown = unknownFields(input, FLIGHT_EDIT_FIELDS);
  if (unknown) return { error: unknown };
  const given = Object.entries(input).filter(([, v]) => v !== null && v.trim() !== "") as [string, string][];
  const cleared = Object.entries(input)
    .filter(([, v]) => v === null || v.trim() === "")
    .map(([k]) => k as keyof typeof FLIGHT_STORED);
  const set: Record<string, string | number | boolean | null> = {};
  const notes: string[] = [];
  const mapped = given.filter(([k]) => MAPPED.has(k));
  if (mapped.length) {
    // Times are read on the flight's date at its airports, the new ones where they change.
    const code = (id: string | null, raw: string | null) => ref.airport(id)?.icao ?? ref.airport(id)?.iata ?? raw;
    const context: Record<string, string | null> = { date: f.scheduledDate ?? flightDay(f), from: code(f.fromAirportId, f.fromRaw), to: code(f.toAirportId, f.toRaw) };
    if (input.duration && !input.takeoff) context.takeoff = clockOf(f.takeoffAt);
    const header = [...new Set([...Object.keys(context), ...mapped.map(([k]) => k)])] as ColumnField[];
    const row = header.map((h) => (input[h] ?? context[h] ?? null) as string | null);
    const c = readMapped({ name: "edit", header, rows: [row], firstRow: 1 }, { kind: "flights", fields: header }, "edit", ref).candidates[0];
    if (!c || c.table !== "flights") return { error: "The values given could not be read as a flight." };
    notes.push(...c.issues.filter((x) => x.severity !== "info").map((x) => x.message));
    const v = c.values as Record<string, unknown>;
    for (const [k] of mapped)
      for (const s of FLIGHT_STORED[k as keyof typeof FLIGHT_STORED]) {
        // "class" sets what it names (cabin, booking class, fare) and leaves the rest.
        if (k === "class" && (v[s] ?? null) === null) continue;
        set[s] = (v[s] ?? null) as string | null;
      }
    for (const k of ["boarding", "takeoff", "landing", "duration"]) if (input[k] && !set[FLIGHT_STORED[k as keyof typeof FLIGHT_STORED][0]!]) return { error: `${k} "${input[k]}" could not be read as a time on ${context.date ?? "the flight's date"}.` };
  }
  // The timetable's departure and arrival: clock times on the flight's date at its airports (the new ones where they
  // change), read as takeoff and landing are; the arrival is the first such time after the departure.
  const depText = input.departureScheduled?.trim() || null;
  const arrText = input.arrivalScheduled?.trim() || null;
  if (depText || arrText) {
    const date = (set.scheduledDate as string | undefined) ?? f.scheduledDate ?? flightDay(f);
    const from = ref.airport(("fromAirportId" in set ? set.fromAirportId : f.fromAirportId) as string | null);
    const to = ref.airport(("toAirportId" in set ? set.toAirportId : f.toAirportId) as string | null);
    if (!date || !from?.tz || !to?.tz) return { error: "The scheduled times need the flight's date and both airports." };
    const anchor = depText ?? clockOf(f.departureScheduledAt) ?? clockOf((set.takeoffAt as string | undefined) ?? f.takeoffAt);
    const t = buildFlightTimes({ scheduledDate: date, originTz: from.tz, destTz: to.tz, takeoff: anchor, landing: arrText });
    if (depText) {
      if (!t.takeoffAt) return { error: `departureScheduled "${depText}" could not be read as a time on ${date}.` };
      set.departureScheduledAt = t.takeoffAt;
    }
    if (arrText) {
      if (!t.landingAt) return { error: `arrivalScheduled "${arrText}" could not be read as a time${anchor ? ` after the departure at ${anchor}` : ": give departureScheduled too"}.` };
      set.arrivalScheduledAt = t.landingAt;
    }
  }
  for (const [k, text] of given) {
    if (MAPPED.has(k) || k === "departureScheduled" || k === "arrivalScheduled") continue;
    if (k === "operatedBy") {
      const op = ref.operatorByCode(text, f.scheduledDate ?? flightDay(f));
      if (!op) return { error: `operatedBy "${text}" is not an airline code or name that is known.` };
      set.operatingAirlineId = op.id;
    } else if (k === "seatPosition" || k === "cabin" || k === "reason") {
      const values = k === "seatPosition" ? SEAT_POSITIONS : k === "cabin" ? CABIN_CLASSES : FLIGHT_REASONS;
      const e = enumOf(values, text);
      if (!e) return { error: `${k} is one of ${values.join(", ")}, not "${text}".` };
      set[FLIGHT_STORED[k][0]!] = e;
    } else if (k === "bookingClass") set.bookingClass = text.trim().toUpperCase();
    else set[FLIGHT_STORED[k as keyof typeof FLIGHT_STORED][0]!] = text.trim();
  }
  const d = diff(f as unknown as Record<string, unknown>, set, cleared.flatMap((k) => FLIGHT_STORED[k] ?? []));
  return { change: { op: "edit", table: "flights", id: f.id, rev: f.rev, set: d.set as Record<string, string | number | boolean | null>, clear: d.clear }, notes };
}

/** An edit of a sighting from fields named as `add` names them, with the web app's others (time, spot, photos, tags). */
export function sightingEdit(store: Store, ref: RefIndex, s: Sighting, input: EditInput): Built<Extract<InboxChange, { op: "edit" }>> {
  const unknown = unknownFields(input, SIGHTING_EDIT_FIELDS);
  if (unknown) return { error: unknown };
  const set: Record<string, string | number | boolean | null> = {};
  const clear: string[] = [];
  let tags: string[] | undefined;
  let phases: string[] | undefined;
  const date = input.date?.trim() || s.seenOn;
  for (const [k, raw] of Object.entries(input)) {
    const text = raw?.trim() ?? "";
    if (!text) {
      if (k === "tags") tags = [];
      else if (k === "phase") phases = [];
      else clear.push(...SIGHTING_STORED[k as keyof typeof SIGHTING_STORED]);
      continue;
    }
    switch (k) {
      case "date":
        if (!isValidDate(text)) return { error: `date is YYYY-MM-DD, not "${text}".` };
        set.seenOn = text;
        break;
      case "time": {
        if (isValidDateTime(text)) set.seenAt = text;
        else {
          const airport = ref.airport(input.airport ? ref.airportByCode(input.airport)?.id : s.airportId);
          const at = /^\d{1,2}:\d{2}$/.test(text) && date && airport ? zonedDateTime(date, text.padStart(5, "0"), airport.tz) : null;
          if (!at) return { error: `time "${text}" needs the sighting's date and a known airport, or a full date-time with its offset.` };
          set.seenAt = at;
        }
        break;
      }
      case "airport":
        set.airportRaw = text;
        set.airportId = ref.airportByCode(text)?.id ?? null;
        break;
      case "airline":
        set.operatorRaw = text;
        set.operatorId = ref.operatorByCode(text, date)?.id ?? null;
        break;
      case "registration":
      case "typeCode":
      case "model": {
        const a = normaliseAircraft({ [`${k}Raw`]: text }, ref) as Record<string, string | null>;
        const [rawField, field] = SIGHTING_STORED[k];
        set[rawField!] = a[rawField!] ?? null;
        set[field!] = a[field!] ?? null;
        break;
      }
      case "phase": {
        // Every status it was seen in, comma-separated: "landing, taxiing".
        const list: string[] = [];
        for (const part of text.split(",").map((x) => x.trim()).filter(Boolean)) {
          const p = enumOf(PHASES, part) ?? phaseOf(part);
          if (!p) return { error: `phase is one of ${PHASES.join(", ")}, or several with commas, not "${part}".` };
          list.push(p);
        }
        phases = PHASES.filter((p) => list.includes(p));
        break;
      }
      case "photos": {
        const n = Number(text);
        if (!Number.isInteger(n) || n < 0) return { error: `photos is a number, not "${text}".` };
        set.photoCount = n;
        break;
      }
      case "tags": {
        const list = text.split(",").map((t) => t.trim().toLowerCase().replace(/[\s-]+/g, "_")).filter(Boolean);
        if (list.some((t) => !TAG_RE.test(t))) return { error: `tags are words such as night or partial_body, not "${text}".` };
        tags = [...new Set(list)];
        break;
      }
      default:
        set[SIGHTING_STORED[k as keyof typeof SIGHTING_STORED][0]!] = text;
    }
  }
  const d = diff(s as unknown as Record<string, unknown>, set, clear);
  const now = tagsOf(store, s.id).sort();
  const sameTags = tags !== undefined && tags.length === now.length && [...tags].sort().every((t, i) => t === now[i]);
  const samePhases = phases !== undefined && phases.join() === phasesOf(store, s.id).join();
  return {
    change: { op: "edit", table: "sightings", id: s.id, rev: s.rev, set: d.set as Record<string, string | number | boolean | null>, clear: d.clear, ...(tags !== undefined && !sameTags && { tags }), ...(phases !== undefined && !samePhases && { phases }) },
    notes: [],
  };
}

/** A change of an aircraft's facts. */
export function airframeEdit(a: Row<"airframes">, input: EditInput): Built<Extract<InboxChange, { op: "airframe" }>> {
  const unknown = unknownFields(input, AIRFRAME_EDIT_FIELDS);
  if (unknown) return { error: unknown };
  const set: Record<string, string | null> = {};
  const clear: string[] = [];
  for (const [k, raw] of Object.entries(input)) {
    const field = AIRFRAME_STORED[k as keyof typeof AIRFRAME_STORED];
    const text = raw?.trim() ?? "";
    if (!text) {
      clear.push(field);
      continue;
    }
    if ((k === "firstFlight" || k === "delivered") && !isValidDate(text)) return { error: `${k} is YYYY-MM-DD, not "${text}".` };
    if (k === "status" && !enumOf(AIRFRAME_STATUSES, text)) return { error: `status is one of ${AIRFRAME_STATUSES.join(", ")}, not "${text}".` };
    set[field] = k === "status" ? enumOf(AIRFRAME_STATUSES, text) : k === "typeCode" ? text.toUpperCase() : text;
  }
  const d = diff(a as unknown as Record<string, unknown>, set, clear);
  return { change: { op: "airframe", id: a.id, rev: a.rev, set: d.set as Record<string, string | null>, clear: d.clear }, notes: [] };
}

export function isEmptyChange(c: InboxChange): boolean {
  return (c.op === "edit" && !Object.keys(c.set).length && !c.clear.length && c.tags === undefined && c.phases === undefined) || (c.op === "airframe" && !Object.keys(c.set).length && !c.clear.length);
}

// ---------- status and applying ----------

export type ChangeStatus = "pending" | "done" | "changed" | "missing";

const SYSTEM = new Set(["id", "rev", "updatedAt", "updatedBy", "basedOn", "versionVector", "deleted"]);
const valuesOf = (row: object) => Object.fromEntries(Object.entries(row).filter(([k]) => !SYSTEM.has(k)));

/** Raw values the record lacks are filled from the normalised ones, so normalising again keeps them. */
const RAW_OF: [string, string][] = [
  ["registrationRaw", "registration"],
  ["typeCodeRaw", "typeCode"],
  ["modelRaw", "model"],
];
/** A raw value given anew is resolved again: its link is dropped unless the change gives it. */
const LINK_OF: [string, string][] = [
  ["airlineRaw", "airlineId"],
  ["fromRaw", "fromAirportId"],
  ["toRaw", "toAirportId"],
  ["operatorRaw", "operatorId"],
  ["airportRaw", "airportId"],
];

function editedValues(cur: object, c: Extract<InboxChange, { op: "edit" }>) {
  const v: Record<string, unknown> = valuesOf(cur);
  for (const [raw, norm] of RAW_OF) if ((v[raw] ?? null) === null && v[norm]) v[raw] = v[norm];
  for (const [raw, link] of LINK_OF) if (raw in c.set && !(link in c.set)) v[link] = null;
  Object.assign(v, c.set);
  for (const k of c.clear) v[k] = null;
  return v;
}

/** The finding a change names, among those open now. */
const findingOf = (findings: Finding[], ruleId: string, fingerprint: string) => findings.find((f) => f.ruleId === ruleId && f.fingerprint === fingerprint) ?? null;

/** Whether a change still has something to do, in the log as it is now. */
export function changeStatus(store: Store, ref: RefIndex, c: InboxChange, findings: () => Finding[]): { status: ChangeStatus; note: string | null } {
  const ok = { status: "pending" as const, note: null };
  const done = (note: string | null = null) => ({ status: "done" as const, note });
  switch (c.op) {
    case "edit": {
      const cur = store.get(c.table, c.id);
      if (!cur) return { status: "missing", note: "It is no longer in the log." };
      const same = Object.entries(c.set).every(([k, v]) => ((cur as unknown as Record<string, unknown>)[k] ?? null) === v) && c.clear.every((k) => ((cur as unknown as Record<string, unknown>)[k] ?? null) === null);
      const now = c.table === "sightings" ? tagsOf(store, c.id).sort() : [];
      const sameTags = c.tags === undefined || (c.tags.length === now.length && [...c.tags].sort().every((t, i) => t === now[i]));
      const samePhases = c.phases === undefined || (c.table === "sightings" && PHASES.filter((p) => c.phases!.includes(p)).join() === phasesOf(store, c.id).join());
      if (same && sameTags && samePhases) return done("The log has these values already.");
      return cur.rev !== c.rev ? { status: "changed", note: "It was changed after this edit was made." } : ok;
    }
    case "delete": {
      const cur = store.get(c.table, c.id);
      if (!cur) return done("It is no longer in the log.");
      return cur.rev !== c.rev ? { status: "changed", note: "It was changed after this deletion was asked for." } : ok;
    }
    case "airframe": {
      const cur = store.get("airframes", c.id);
      if (!cur) return { status: "missing", note: "The aircraft is no longer in the log." };
      const same = Object.entries(c.set).every(([k, v]) => ((cur as unknown as Record<string, unknown>)[k] ?? null) === v) && c.clear.every((k) => ((cur as unknown as Record<string, unknown>)[k] ?? null) === null);
      if (same) return done("The aircraft has these values already.");
      return cur.rev !== c.rev ? { status: "changed", note: "The aircraft was changed after this edit was made." } : ok;
    }
    case "merge":
      if (!store.get("airframes", c.from)) return done("The aircraft was merged or removed already.");
      return store.get("airframes", c.into) ? ok : { status: "missing", note: "The aircraft to merge into is no longer in the log." };
    case "accept":
      if (store.all("issue_acks").some((a) => a.ruleId === c.ruleId && a.fingerprint === c.fingerprint)) return done("It is accepted already.");
      return findingOf(findings(), c.ruleId, c.fingerprint) ? ok : { status: "missing", note: "That finding no longer applies: the values it was about have changed." };
    case "reopen":
      return store.get("issue_acks", c.ackId) ? ok : done("It is not accepted.");
    case "fix": {
      const f = findingOf(findings(), c.ruleId, c.fingerprint);
      if (!f) return { status: "missing", note: "That finding no longer applies: the values it was about have changed." };
      return f.fixes[c.fix] ? ok : { status: "missing", note: "That finding has no such fix now." };
    }
    case "undo": {
      const b = store.get("import_batches", c.batchId);
      if (!b) return { status: "missing", note: "There is no such import in the log." };
      return b.status === "undone" ? done("It was undone already.") : ok;
    }
    case "family": {
      const now = store.all("family_overrides").find((o) => o.designator === c.designator)?.familyId ?? null;
      return now === c.familyId ? done("The type is counted that way already.") : ok;
    }
    case "settings": {
      const s = store.get("settings", "settings") as Record<string, unknown> | null;
      return Object.entries(c.set).every(([k, v]) => (s?.[k] ?? null) === v) ? done("The settings are so already.") : ok;
    }
    case "view":
      return store.all("saved_views").some((v) => v.name === c.name && v.dataset === c.dataset && v.rowDimension === c.rowDimension && (v.columnDimension ?? null) === c.columnDimension && v.measure === c.measure)
        ? done("This view is saved already.")
        : ok;
    case "removeView":
      return store.get("saved_views", c.id) ? ok : done("It is not saved.");
    case "facts": {
      if (!store.get("airframes", c.id)) return { status: "missing", note: "The aircraft is no longer in the log." };
      const e = airframeFactsEffect(store, ref, c.id, c.facts, { overwriteImported: c.overwriteImported });
      if (e.rejected) return { status: "missing", note: `These facts no longer fit your records: ${e.rejected}.` };
      return e.applied.length || e.mergedInto ? ok : done("The aircraft has these facts already, or your own values, which are kept.");
    }
    case "track": {
      if (!store.get("flights", c.flightId)) return { status: "missing", note: "The flight is no longer in the log." };
      const cur = store.all("tracks").find((t) => t.flightId === c.flightId);
      const same = cur && cur.provider === c.provider && cur.pointCount === c.points.length && cur.firstPointAt === toUtcIso(c.points[0]![0] * 1000) && cur.lastPointAt === toUtcIso(c.points[c.points.length - 1]![0] * 1000);
      return same ? done("The flight has this track already.") : ok;
    }
    case "removeTrack":
      if (!store.get("flights", c.flightId)) return done("The flight is no longer in the log.");
      return store.all("tracks").some((t) => t.flightId === c.flightId) ? ok : done("The flight has no recorded track.");
  }
}

/** Apply one change. Returns what to tell the user when it did more than the change says (a named operator's fix). */
export function applyChange(store: Store, ref: RefIndex, c: InboxChange, findings: () => Finding[], opts: EditOptions = {}): string | null {
  switch (c.op) {
    case "edit": {
      const cur = store.get(c.table, c.id);
      if (!cur) return null;
      const values = editedValues(cur, c);
      // A registration, type or model fixed after it was typed keeps its fix when the edit leaves it alone.
      const touched = new Set([...Object.keys(c.set), ...c.clear]);
      const keepNormalised = RAW_OF.filter(([raw, norm]) => !touched.has(raw) && !touched.has(norm)).map(([, norm]) => norm);
      if (c.table === "flights") saveFlight(store, ref, values, c.id, { ...opts, keepNormalised });
      else {
        // The phases are kept in their own table and the row's phase column stays empty: read back with the row, it would clear them.
        if (!("phase" in c.set) && !c.clear.includes("phase")) delete values.phase;
        saveSighting(store, ref, values, c.id, c.tags, { ...opts, keepNormalised });
        if (c.phases !== undefined) setPhases(store, c.id, c.phases);
      }
      return null;
    }
    case "delete":
      deleteRecord(store, ref, c.table, c.id, opts);
      return null;
    case "airframe":
      updateAirframe(store, ref, c.id, { ...c.set, ...Object.fromEntries(c.clear.map((k) => [k, null])) } as Partial<Row<"airframes">>, opts);
      return null;
    case "merge":
      mergeAirframes(store, ref, c.into, c.from, opts);
      return null;
    case "accept": {
      const f = findingOf(findings(), c.ruleId, c.fingerprint);
      if (f) acceptFinding(store, f, c.note);
      return null;
    }
    case "reopen":
      reopenFinding(store, c.ackId);
      return null;
    case "fix": {
      const fix = findingOf(findings(), c.ruleId, c.fingerprint)?.fixes[c.fix];
      return fix ? applyFix(store, ref, fix, opts).message : null;
    }
    case "undo": {
      // Records changed after the import are left, unless the change says to undo them too (as the web app asks).
      const r = undoImport(store, ref, c.batchId, c.force ?? false);
      const left = new Set(r.editedSince).size;
      return left ? `${left === 1 ? "1 record" : `${left} records`} changed after that import ${left === 1 ? "was" : "were"} left as ${left === 1 ? "it is" : "they are"}; the import stays to undo.` : null;
    }
    case "family":
      setFamily(store, c.designator, c.familyId);
      return null;
    case "settings":
      updateSettings(store, c.set);
      return null;
    case "view":
      saveView(store, { name: c.name, dataset: c.dataset, rowDimension: c.rowDimension, columnDimension: c.columnDimension, measure: c.measure });
      return null;
    case "removeView":
      removeView(store, c.id);
      return null;
    case "facts": {
      const out = applyAirframeFacts(store, ref, c.id, c.facts, { overwriteImported: c.overwriteImported });
      return out.mergedInto ? "It has the serial number of another aircraft in your log, so the two were merged." : null;
    }
    case "track":
      attachTrack(store, c.flightId, c.points.map(tuplePoint), { provider: c.provider, attribution: c.attribution, coverage: c.coverage, distanceKm: c.distanceKm, now: opts.now });
      return null;
    case "removeTrack":
      removeTrack(store, c.flightId);
      return null;
  }
}

/** A copy of the log to try changes on (the review), every row and tombstone included. */
export function copyStore(store: Store): Store {
  const copy = new Store({ deviceId: store.deviceId, validate: false });
  for (const t of Object.keys(TABLES) as TableName[]) copy.load(t, store.allWithDeleted(t) as never);
  return copy;
}

/** Open findings as the checks see them now, airframes linked first. */
export function currentFindings(store: Store, ref: RefIndex): Finding[] {
  return checkAll(store, ref, { overlaps: resolveAirframes(store, ref).overlaps });
}

export interface AppliedChanges {
  batchId: string;
  applied: number;
  skipped: number;
  /** What a change did beyond itself, for the user. */
  messages: string[];
}

/**
 * Apply the changes the user took as one import batch. Every row they touch, the airframe links worked out again
 * included, gets a history row with its version before (none for a row they create), so undoing the import puts
 * each back. A change that is done already or whose record is gone is left out.
 */
export function applyChanges(store: Store, ref: RefIndex, changes: InboxChange[], take: (index: number, status: ChangeStatus) => boolean, meta: { fileName: string; now?: number }): AppliedChanges {
  const now = meta.now ?? Date.now();
  const first = new Map<string, Change>();
  // Track points have no versions of their own: each track's points as they were go into one history row.
  const pointsBefore = new Map<string, Map<string, Record<string, unknown> | null>>();
  const unsubscribe = store.subscribe((list) => {
    for (const c of list) {
      if (c.table === "import_batches" || c.table === "record_history") continue;
      if (c.table === "track_points") {
        const trackId = c.id.slice(0, c.id.lastIndexOf("|"));
        const seen = pointsBefore.get(trackId) ?? new Map<string, Record<string, unknown> | null>();
        if (!seen.has(c.id)) seen.set(c.id, (c.before as unknown as Record<string, unknown> | null) ?? null);
        pointsBefore.set(trackId, seen);
        continue;
      }
      const k = `${c.table}|${c.id}`;
      if (!first.has(k)) first.set(k, c);
    }
  });
  const result: AppliedChanges = { batchId: "", applied: 0, skipped: 0, messages: [] };
  try {
    store.batch(() => {
      result.batchId = store.insert("import_batches", { createdAt: toUtcIso(now), sourceKind: "manual", fileName: meta.fileName, mappingPreset: "touchdown_changes", rowsRead: changes.length, agentChecker: "none", status: "committed" }).id;
      let cached: Finding[] | null = null;
      const findings = () => (cached ??= currentFindings(store, ref));
      changes.forEach((c, i) => {
        const { status } = changeStatus(store, ref, c, findings);
        if (status === "done" || status === "missing" || !take(i, status)) {
          result.skipped++;
          return;
        }
        const message = applyChange(store, ref, c, findings, { now, history: false });
        if (message) result.messages.push(message);
        cached = null;
        result.applied++;
      });
      resolveAirframes(store, ref);
    });
  } finally {
    unsubscribe();
  }
  store.batch(() => {
    for (const c of first.values()) {
      const before = c.before as unknown as { rev?: number } | null;
      store.insert("record_history", { tableName: c.table, recordId: c.id, recordRev: before?.rev ?? null, row: (before as Record<string, unknown> | null) ?? null, changedAt: toUtcIso(now), batchId: result.batchId, reason: "import" });
    }
    for (const [trackId, seen] of pointsBefore) {
      const points = [...seen.values()].filter((p): p is Record<string, unknown> => p !== null);
      store.insert("record_history", { tableName: "track_points", recordId: trackId, recordRev: null, row: points.length ? { points } : null, changedAt: toUtcIso(now), batchId: result.batchId, reason: "import" });
    }
    store.update("import_batches", result.batchId, { rowsAccepted: result.applied, rowsRejected: result.skipped });
  });
  return result;
}

export const tableOfChange = (c: InboxChange): TableName | null =>
  c.op === "edit" || c.op === "delete" ? c.table : c.op === "airframe" || c.op === "merge" || c.op === "facts" ? "airframes" : c.op === "track" || c.op === "removeTrack" ? "flights" : null;
