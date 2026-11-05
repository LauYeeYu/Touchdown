// Changes to what is in the log already, made on the command line and imported only after a review (docs/34,
// "Change files"): edits, deletions, aircraft facts and merges, accepted and reopened findings, suggested fixes,
// undone imports, family choices, settings, saved Statistics views, facts looked up for an aircraft and a flight's
// recorded track, added, replaced or removed. They travel in an inbox file (version 3) and are applied with the
// same code as the web app's own changes (edit.ts), as one import batch that can be undone like any other.

import { t } from "@touchdown/i18n";
import { flightDay } from "../derive.ts";
import { acceptFinding, applyFix, deleteRecord, mergeAirframes, removeView, reopenFinding, saveFlight, saveSighting, saveView, setFamily, tagsOf, updateAirframe, updateSettings, viewFilters, type EditOptions, type SavedView } from "../edit.ts";
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
import { instant, parseClock, parseDateTime, toUtcIso, zonedDateTime, zonedInstants } from "../time/index.ts";
import { phaseOf, readMapped, type ColumnField } from "./mapping.ts";
import { buildFlightTimes, firstClockAfter } from "./times.ts";
import { phasesOf, setPhases } from "../phases.ts";
import { withPrivate } from "../private.ts";
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
  if (!Array.isArray(points) || points.length < 2 || points.length > MAX_TRACK_POINTS) return t("importer.points.count", { max: MAX_TRACK_POINTS });
  let previous = -Infinity;
  for (const p of points) {
    if (!Array.isArray(p) || p.length !== 6) return t("importer.points.point");
    const [time, lat, lon, ...rest] = p as unknown[];
    if (!Number.isInteger(time) || (time as number) <= previous) return t("importer.points.order");
    if (typeof lat !== "number" || typeof lon !== "number" || Math.abs(lat) > 90 || Math.abs(lon) > 180) return t("importer.points.position");
    if (!rest.every(optionalNumber)) return t("importer.points.values");
    previous = time as number;
  }
  return null;
}

export type ChangeOp = InboxChange["op"];
export const CHANGE_OPS: readonly ChangeOp[] = ["edit", "delete", "airframe", "merge", "accept", "reopen", "fix", "undo", "family", "settings", "view", "removeView", "facts", "track", "removeTrack"];

const text = (v: unknown, max: number) => v === null || (typeof v === "string" && v.length <= max);
const dateOrNull = (v: unknown) => v === null || v === undefined || (typeof v === "string" && isValidDate(v));

/** What is wrong with looked-up facts in a change file, or null. */
function factsProblem(f: Record<string, unknown> | null): string | null {
  if (!f || typeof f !== "object" || Array.isArray(f)) return t("importer.facts.notObject");
  const allowed = ["provider", "url", "fetchedAt", "registration", "manufacturer", "msn", "lineNumber", "typeText", "typeCode", "firstFlightDate", "deliveryDate", "status", "notBefore", "notBeforeLabel", "registrations", "icaoHex"];
  const extra = Object.keys(f).filter((k) => !allowed.includes(k));
  if (extra.length) return t("importer.facts.keys", { keys: extra.join(", ") });
  if (typeof f.provider !== "string" || !/^[a-z0-9_]{1,30}$/.test(f.provider)) return t("importer.facts.provider");
  if (!(f.url === null || (typeof f.url === "string" && /^https:\/\/[^\s]{1,500}$/.test(f.url)))) return t("importer.facts.address");
  if (typeof f.fetchedAt !== "string" || !isValidDateTime(f.fetchedAt)) return t("importer.facts.fetchedAt");
  if (typeof f.registration !== "string" || !f.registration || f.registration.length > 20) return t("importer.facts.registration");
  for (const k of ["manufacturer", "msn", "lineNumber", "typeText", "typeCode"]) if (!text(f[k], 200)) return t("importer.facts.malformed", { key: k });
  for (const k of ["firstFlightDate", "deliveryDate", "notBefore"]) if (!dateOrNull(f[k])) return t("importer.facts.notDate", { key: k });
  if (!(f.notBeforeLabel === undefined || text(f.notBeforeLabel, 200))) return t("importer.facts.malformed", { key: "notBeforeLabel" });
  if (!(f.status === null || (AIRFRAME_STATUSES as readonly unknown[]).includes(f.status))) return t("importer.facts.status");
  if (!(f.icaoHex === undefined || f.icaoHex === null || (typeof f.icaoHex === "string" && /^[0-9a-fA-F]{6}$/.test(f.icaoHex)))) return t("importer.facts.hex");
  const regs = f.registrations;
  if (!Array.isArray(regs) || regs.length > 50) return t("importer.facts.registrations");
  for (const r of regs as Record<string, unknown>[]) {
    if (!r || typeof r !== "object" || Object.keys(r).some((k) => !["registration", "from", "to", "operator"].includes(k))) return t("importer.facts.registrations");
    if (typeof r.registration !== "string" || r.registration.length > 20 || !dateOrNull(r.from) || !dateOrNull(r.to) || !text(r.operator ?? null, 200)) return t("importer.facts.registrations");
  }
  return null;
}

const MEASURES = ["records", "aircraft", "distance", "time"] as const;

/** "flights and sightings". */
const andList = (items: readonly string[]) => (items.length ? items.reduce((first, second) => t("core.list.and", { first, second })) : "");

/** At most this many filters in a view, and values in one. */
const MAX_FILTERS = 10;
const MAX_FILTER_VALUES = 200;

/**
 * What is wrong with a view, or null: dimensions of its dataset, two different ones, distance and time for flights,
 * and filters on dimensions of its dataset, one each, with values.
 */
export function viewProblem(v: { dataset: unknown; rowDimension: unknown; columnDimension: unknown; measure: unknown; filters?: unknown }): string | null {
  if (v.dataset !== "flights" && v.dataset !== "sightings") return t("importer.view.dataset");
  const dim = (id: unknown) => DIMENSIONS.find((d) => d.id === id);
  const row = dim(v.rowDimension);
  if (!row) return t("importer.view.notDimension", { dimension: String(v.rowDimension) });
  if (!row.datasets.includes(v.dataset)) return t("importer.view.wrongDataset", { dimension: row.id, datasets: andList(row.datasets), dataset: v.dataset });
  if (v.columnDimension !== null) {
    const col = dim(v.columnDimension);
    if (!col) return t("importer.view.notDimension", { dimension: String(v.columnDimension) });
    if (!col.datasets.includes(v.dataset)) return t("importer.view.wrongDataset", { dimension: col.id, datasets: andList(col.datasets), dataset: v.dataset });
    if (col.id === row.id) return t("importer.view.sameDimension");
  }
  if (!(MEASURES as readonly unknown[]).includes(v.measure)) return t("importer.view.measure", { measures: MEASURES.join(", ") });
  if (v.dataset === "sightings" && (v.measure === "distance" || v.measure === "time")) return t("importer.view.flightsOnly");
  if (v.filters === undefined) return null;
  if (!Array.isArray(v.filters) || v.filters.length > MAX_FILTERS) return t("importer.view.filters");
  const seen = new Set<string>();
  for (const f of v.filters as Record<string, unknown>[]) {
    if (!f || typeof f !== "object" || Object.keys(f).some((k) => k !== "dimension" && k !== "values")) return t("importer.view.filters");
    const d = dim(f.dimension);
    if (!d) return t("importer.view.notDimension", { dimension: String(f.dimension) });
    if (!d.datasets.includes(v.dataset)) return t("importer.view.wrongDataset", { dimension: d.id, datasets: andList(d.datasets), dataset: v.dataset });
    if (seen.has(d.id)) return t("importer.view.twice", { dimension: d.id });
    seen.add(d.id);
    const values = f.values;
    if (!Array.isArray(values) || !values.length || values.length > MAX_FILTER_VALUES || values.some((x) => typeof x !== "string" || !x || x.length > 200)) return t("importer.view.values", { dimension: d.id });
  }
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
  if (!Array.isArray(list)) return { error: t("importer.changes.notList") };
  if (list.length > MAX_CHANGES) return { error: t("importer.changes.tooMany", { max: MAX_CHANGES }) };
  const out: InboxChange[] = [];
  for (const [i, raw] of list.entries()) {
    const n = i + 1;
    const c = raw as Record<string, unknown> | null;
    if (!c || typeof c !== "object" || !CHANGE_OPS.includes(c.op as ChangeOp)) return { error: t("importer.changes.malformedChange", { n }) };
    const keys = (allowed: string[]) => Object.keys(c).filter((k) => k !== "op" && !allowed.includes(k));
    const bad = (problem: string) => ({ error: t("importer.changes.bad", { n, op: String(c.op), problem }) });
    switch (c.op) {
      case "edit":
      case "delete": {
        if (keys(c.op === "edit" ? ["table", "id", "rev", "set", "clear", "tags", "phases"] : ["table", "id", "rev"]).length) return bad(t("importer.changes.unexpectedKeys"));
        if (c.table !== "flights" && c.table !== "sightings") return bad(t("importer.changes.table"));
        if (!isId(c.id) || !isRev(c.rev)) return bad(t("importer.changes.idRev"));
        if (c.op === "delete") break;
        const set = c.set as Record<string, unknown>;
        if (!set || typeof set !== "object" || Array.isArray(set)) return bad(t("importer.changes.setNotObject"));
        const fields = EDITABLE[c.table];
        for (const [k, v] of Object.entries(set)) if (!fields.has(k) || !isValue(v)) return bad(t("importer.changes.cannotSet", { field: k }));
        if (!Array.isArray(c.clear) || c.clear.some((k) => typeof k !== "string" || !fields.has(k))) return bad(t("importer.changes.clear"));
        if (c.tags !== undefined && (c.table !== "sightings" || !Array.isArray(c.tags) || c.tags.length > 20 || c.tags.some((t) => typeof t !== "string" || !TAG_RE.test(t)))) return bad(t("importer.changes.tags"));
        if (c.phases !== undefined && (c.table !== "sightings" || !Array.isArray(c.phases) || c.phases.some((p) => !(PHASES as readonly unknown[]).includes(p)))) return bad(t("importer.changes.phases"));
        break;
      }
      case "airframe": {
        if (keys(["id", "rev", "set", "clear"]).length) return bad(t("importer.changes.unexpectedKeys"));
        if (!isId(c.id) || !isRev(c.rev)) return bad(t("importer.changes.idRev"));
        const set = c.set as Record<string, unknown>;
        if (!set || typeof set !== "object") return bad(t("importer.changes.setNotObject"));
        for (const [k, v] of Object.entries(set)) if (!EDITABLE.airframes.has(k) || !(v === null || (typeof v === "string" && v.length <= 300))) return bad(t("importer.changes.cannotSet", { field: k }));
        if (!Array.isArray(c.clear) || c.clear.some((k) => typeof k !== "string" || !EDITABLE.airframes.has(k))) return bad(t("importer.changes.clear"));
        break;
      }
      case "merge":
        if (keys(["into", "from"]).length || !isId(c.into) || !isId(c.from) || c.into === c.from) return bad(t("importer.changes.merge"));
        break;
      case "accept":
      case "fix":
        if (keys(c.op === "accept" ? ["ruleId", "fingerprint", "note"] : ["ruleId", "fingerprint", "fix"]).length) return bad(t("importer.changes.unexpectedKeys"));
        if (typeof c.ruleId !== "string" || !RULES[c.ruleId] || typeof c.fingerprint !== "string" || !/^[0-9a-f]{8}$/.test(c.fingerprint)) return bad(t("importer.changes.unknownFinding"));
        if (c.op === "accept" && !(c.note === null || (typeof c.note === "string" && c.note.length <= 500))) return bad(t("importer.changes.note"));
        if (c.op === "fix" && !(Number.isInteger(c.fix) && (c.fix as number) >= 0 && (c.fix as number) < 20)) return bad(t("importer.changes.fixNumber"));
        break;
      case "reopen":
        if (keys(["ackId"]).length || !isId(c.ackId)) return bad(t("importer.changes.malformed"));
        break;
      case "undo":
        if (keys(["batchId", "force"]).length || !isId(c.batchId) || (c.force !== undefined && typeof c.force !== "boolean")) return bad(t("importer.changes.malformed"));
        break;
      case "family":
        if (keys(["designator", "familyId"]).length || typeof c.designator !== "string" || !/^[A-Z0-9]{2,4}$/.test(c.designator) || !(c.familyId === null || isId(c.familyId))) return bad(t("importer.changes.malformed"));
        break;
      case "settings": {
        const set = c.set as Record<string, unknown>;
        if (keys(["set"]).length || !set || typeof set !== "object" || !Object.keys(set).length) return bad(t("importer.changes.malformed"));
        for (const [k, v] of Object.entries(set)) if (!(k in SETTING_VALUES) || !SETTING_VALUES[k as keyof LogSettings].includes(v as string)) return bad(t("importer.changes.settingValue", { setting: k, value: String(v) }));
        break;
      }
      case "view": {
        if (keys(["name", "dataset", "rowDimension", "columnDimension", "measure", "filters"]).length) return bad(t("importer.changes.unexpectedKeys"));
        if (typeof c.name !== "string" || !c.name.trim() || c.name.length > 80) return bad(t("importer.changes.name"));
        const problem = viewProblem({ dataset: c.dataset, rowDimension: c.rowDimension, columnDimension: c.columnDimension ?? null, measure: c.measure, filters: c.filters });
        if (problem) return bad(problem);
        break;
      }
      case "removeView":
        if (keys(["id"]).length || !isId(c.id)) return bad(t("importer.changes.malformed"));
        break;
      case "facts": {
        if (keys(["id", "facts", "overwriteImported"]).length || !isId(c.id) || (c.overwriteImported !== undefined && typeof c.overwriteImported !== "boolean")) return bad(t("importer.changes.malformed"));
        const problem = factsProblem(c.facts as Record<string, unknown> | null);
        if (problem) return bad(problem);
        break;
      }
      case "track": {
        if (keys(["flightId", "provider", "attribution", "coverage", "distanceKm", "points"]).length || !isId(c.flightId)) return bad(t("importer.changes.malformed"));
        if (!(TRACK_PROVIDERS as readonly unknown[]).includes(c.provider) || (c.coverage !== "complete" && c.coverage !== "partial")) return bad(t("importer.changes.provider"));
        if (typeof c.attribution !== "string" || !c.attribution.trim() || c.attribution.length > 200) return bad(t("importer.changes.attribution"));
        if (typeof c.distanceKm !== "number" || !Number.isFinite(c.distanceKm) || c.distanceKm < 0 || c.distanceKm > 50_000) return bad(t("importer.changes.distance"));
        const problem = trackPointsProblem(c.points);
        if (problem) return bad(problem);
        break;
      }
      case "removeTrack":
        if (keys(["flightId"]).length || !isId(c.flightId)) return bad(t("importer.changes.malformed"));
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
  return bad.length ? t("importer.edit.unknownFields", { fields: bad.join(", "), count: bad.length, allowed: allowed.join(", ") }) : null;
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
    if (!c || c.table !== "flights") return { error: t("importer.edit.notFlight") };
    notes.push(...c.issues.filter((x) => x.severity !== "info").map((x) => x.message));
    const v = c.values as Record<string, unknown>;
    for (const [k] of mapped)
      for (const s of FLIGHT_STORED[k as keyof typeof FLIGHT_STORED]) {
        // "class" sets what it names (cabin, booking class, fare) and leaves the rest.
        if (k === "class" && (v[s] ?? null) === null) continue;
        set[s] = (v[s] ?? null) as string | null;
      }
    // A landing given without a takeoff is the first such clock time at the arrival airport after the flight's takeoff,
    // else after its timetable departure, else from the start of its date (said in a note: it may be a day early).
    const landingClock = input.landing?.trim() ?? "";
    if (landingClock && !input.takeoff && !set.landingAt && parseClock(landingClock)) {
      const from = ref.airport(("fromAirportId" in set ? set.fromAirportId : f.fromAirportId) as string | null);
      const to = ref.airport(("toAirportId" in set ? set.toAirportId : f.toAirportId) as string | null);
      const date = (set.scheduledDate as string | undefined) ?? f.scheduledDate ?? flightDay(f);
      const kept = !("scheduledDate" in set) ? (instant(f.takeoffAt) ?? instant(f.departureScheduledAt)) : null;
      const start = kept ?? (date && from?.tz ? (zonedInstants(date, "00:00", from.tz)[0] ?? null) : null);
      if (start !== null && to?.tz) {
        set.landingAt = firstClockAfter(start, landingClock, to.tz);
        if (set.landingAt && kept === null) notes.push(t("importer.edit.landingNote", { clock: landingClock, date: date ?? "", airport: from!.iata ?? from!.icao ?? "" }));
      }
    }
    for (const k of ["boarding", "takeoff", "landing", "duration"]) if (input[k] && !set[FLIGHT_STORED[k as keyof typeof FLIGHT_STORED][0]!]) return { error: context.date ? t("importer.edit.notTime", { field: k, value: input[k], date: context.date }) : t("importer.edit.notTimeNoDate", { field: k, value: input[k] }) };
  }
  // The timetable's departure and arrival: clock times on the flight's date at its airports (the new ones where they
  // change), read as takeoff and landing are; the arrival is the first such time after the departure.
  const depText = input.departureScheduled?.trim() || null;
  const arrText = input.arrivalScheduled?.trim() || null;
  if (depText || arrText) {
    const date = (set.scheduledDate as string | undefined) ?? f.scheduledDate ?? flightDay(f);
    const from = ref.airport(("fromAirportId" in set ? set.fromAirportId : f.fromAirportId) as string | null);
    const to = ref.airport(("toAirportId" in set ? set.toAirportId : f.toAirportId) as string | null);
    if (!date || !from?.tz || !to?.tz) return { error: t("importer.edit.scheduledNeeds") };
    const anchor = depText ?? clockOf(f.departureScheduledAt) ?? clockOf((set.takeoffAt as string | undefined) ?? f.takeoffAt);
    const times = buildFlightTimes({ scheduledDate: date, originTz: from.tz, destTz: to.tz, takeoff: anchor, landing: arrText });
    if (depText) {
      if (!times.takeoffAt) return { error: t("importer.edit.notTime", { field: "departureScheduled", value: depText, date }) };
      set.departureScheduledAt = times.takeoffAt;
    }
    if (arrText) {
      if (!times.landingAt) return { error: anchor ? t("importer.edit.arrivalNotTime", { value: arrText, departure: anchor }) : t("importer.edit.arrivalNoDeparture", { value: arrText }) };
      set.arrivalScheduledAt = times.landingAt;
    }
  }
  for (const [k, text] of given) {
    if (MAPPED.has(k) || k === "departureScheduled" || k === "arrivalScheduled") continue;
    if (k === "operatedBy") {
      const where = [("fromAirportId" in set ? set.fromAirportId : f.fromAirportId) as string | null, ("toAirportId" in set ? set.toAirportId : f.toAirportId) as string | null];
      const op = ref.operatorByCode(text, f.scheduledDate ?? flightDay(f), where.map((id) => ref.airport(id)?.country));
      if (!op) return { error: t("importer.edit.operatedBy", { value: text }) };
      set.operatingAirlineId = op.id;
    } else if (k === "seatPosition" || k === "cabin" || k === "reason") {
      const values = k === "seatPosition" ? SEAT_POSITIONS : k === "cabin" ? CABIN_CLASSES : FLIGHT_REASONS;
      const e = enumOf(values, text);
      if (!e) return { error: t("importer.edit.oneOf", { field: k, values: values.join(", "), value: text }) };
      set[FLIGHT_STORED[k][0]!] = e;
    } else if (k === "bookingClass") set.bookingClass = text.trim().toUpperCase();
    else set[FLIGHT_STORED[k as keyof typeof FLIGHT_STORED][0]!] = text.trim();
  }
  const d = diff(withPrivate(store, f) as unknown as Record<string, unknown>, set, cleared.flatMap((k) => FLIGHT_STORED[k] ?? []));
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
        if (!isValidDate(text)) return { error: t("importer.edit.date", { field: "date", value: text }) };
        set.seenOn = text;
        break;
      case "time": {
        if (isValidDateTime(text)) set.seenAt = text;
        else {
          const airport = ref.airport(input.airport ? ref.airportByCode(input.airport)?.id : s.airportId);
          const at = /^\d{1,2}:\d{2}$/.test(text) && date && airport ? zonedDateTime(date, text.padStart(5, "0"), airport.tz) : null;
          if (!at) return { error: t("importer.edit.time", { value: text }) };
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
          if (!p) return { error: t("importer.edit.phase", { values: PHASES.join(", "), value: part }) };
          list.push(p);
        }
        phases = PHASES.filter((p) => list.includes(p));
        break;
      }
      case "photos": {
        const n = Number(text);
        if (!Number.isInteger(n) || n < 0) return { error: t("importer.edit.photos", { value: text }) };
        set.photoCount = n;
        break;
      }
      case "tags": {
        const list = text.split(",").map((t) => t.trim().toLowerCase().replace(/[\s-]+/g, "_")).filter(Boolean);
        if (list.some((t) => !TAG_RE.test(t))) return { error: t("importer.edit.tags", { value: text }) };
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
    if ((k === "firstFlight" || k === "delivered") && !isValidDate(text)) return { error: t("importer.edit.date", { field: k, value: text }) };
    if (k === "status" && !enumOf(AIRFRAME_STATUSES, text)) return { error: t("importer.edit.oneOf", { field: "status", values: AIRFRAME_STATUSES.join(", "), value: text }) };
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
      const row = store.get(c.table, c.id);
      if (!row) return { status: "missing", note: t("importer.status.gone") };
      // A flight's ticket number and booking reference are in its private row.
      const cur = c.table === "flights" ? withPrivate(store, row as Row<"flights">) : row;
      const same = Object.entries(c.set).every(([k, v]) => ((cur as unknown as Record<string, unknown>)[k] ?? null) === v) && c.clear.every((k) => ((cur as unknown as Record<string, unknown>)[k] ?? null) === null);
      const now = c.table === "sightings" ? tagsOf(store, c.id).sort() : [];
      const sameTags = c.tags === undefined || (c.tags.length === now.length && [...c.tags].sort().every((t, i) => t === now[i]));
      const samePhases = c.phases === undefined || (c.table === "sightings" && PHASES.filter((p) => c.phases!.includes(p)).join() === phasesOf(store, c.id).join());
      if (same && sameTags && samePhases) return done(t("importer.status.same"));
      return cur.rev !== c.rev ? { status: "changed", note: t("importer.status.editChanged") } : ok;
    }
    case "delete": {
      const cur = store.get(c.table, c.id);
      if (!cur) return done(t("importer.status.gone"));
      return cur.rev !== c.rev ? { status: "changed", note: t("importer.status.deleteChanged") } : ok;
    }
    case "airframe": {
      const cur = store.get("airframes", c.id);
      if (!cur) return { status: "missing", note: t("importer.status.aircraftGone") };
      const same = Object.entries(c.set).every(([k, v]) => ((cur as unknown as Record<string, unknown>)[k] ?? null) === v) && c.clear.every((k) => ((cur as unknown as Record<string, unknown>)[k] ?? null) === null);
      if (same) return done(t("importer.status.aircraftSame"));
      return cur.rev !== c.rev ? { status: "changed", note: t("importer.status.aircraftChanged") } : ok;
    }
    case "merge":
      if (!store.get("airframes", c.from)) return done(t("importer.status.merged"));
      return store.get("airframes", c.into) ? ok : { status: "missing", note: t("importer.status.mergeIntoGone") };
    case "accept":
      if (store.all("issue_acks").some((a) => a.ruleId === c.ruleId && a.fingerprint === c.fingerprint)) return done(t("importer.status.accepted"));
      return findingOf(findings(), c.ruleId, c.fingerprint) ? ok : { status: "missing", note: t("importer.status.findingGone") };
    case "reopen":
      return store.get("issue_acks", c.ackId) ? ok : done(t("importer.status.notAccepted"));
    case "fix": {
      const f = findingOf(findings(), c.ruleId, c.fingerprint);
      if (!f) return { status: "missing", note: t("importer.status.findingGone") };
      return f.fixes[c.fix] ? ok : { status: "missing", note: t("importer.status.noFix") };
    }
    case "undo": {
      const b = store.get("import_batches", c.batchId);
      if (!b) return { status: "missing", note: t("importer.status.noImport") };
      return b.status === "undone" ? done(t("importer.status.undone")) : ok;
    }
    case "family": {
      const now = store.all("family_overrides").find((o) => o.designator === c.designator)?.familyId ?? null;
      return now === c.familyId ? done(t("importer.status.family")) : ok;
    }
    case "settings": {
      const s = store.get("settings", "settings") as Record<string, unknown> | null;
      return Object.entries(c.set).every(([k, v]) => (s?.[k] ?? null) === v) ? done(t("importer.status.settings")) : ok;
    }
    case "view": {
      const sameFilters = (id: string) => JSON.stringify(viewFilters(store, id)) === JSON.stringify((c.filters ?? []).filter((f) => f.values.length));
      return store.all("saved_views").some((v) => v.name === c.name && v.dataset === c.dataset && v.rowDimension === c.rowDimension && (v.columnDimension ?? null) === c.columnDimension && v.measure === c.measure && sameFilters(v.id))
        ? done(t("importer.status.viewSaved"))
        : ok;
    }
    case "removeView":
      return store.get("saved_views", c.id) ? ok : done(t("importer.status.notSaved"));
    case "facts": {
      if (!store.get("airframes", c.id)) return { status: "missing", note: t("importer.status.aircraftGone") };
      const e = airframeFactsEffect(store, ref, c.id, c.facts, { overwriteImported: c.overwriteImported });
      if (e.rejected) return { status: "missing", note: t("importer.status.factsMismatch", { reason: e.rejected }) };
      return e.applied.length || e.mergedInto ? ok : done(t("importer.status.factsSame"));
    }
    case "track": {
      if (!store.get("flights", c.flightId)) return { status: "missing", note: t("importer.status.flightGone") };
      const cur = store.all("tracks").find((t) => t.flightId === c.flightId);
      const same = cur && cur.provider === c.provider && cur.pointCount === c.points.length && cur.firstPointAt === toUtcIso(c.points[0]![0] * 1000) && cur.lastPointAt === toUtcIso(c.points[c.points.length - 1]![0] * 1000);
      return same ? done(t("importer.status.trackSame")) : ok;
    }
    case "removeTrack":
      if (!store.get("flights", c.flightId)) return done(t("importer.status.flightGone"));
      return store.all("tracks").some((t) => t.flightId === c.flightId) ? ok : done(t("importer.status.noTrack"));
  }
}

/** Apply one change. Returns what to tell the user when it did more than the change says (a named operator's fix). */
export function applyChange(store: Store, ref: RefIndex, c: InboxChange, findings: () => Finding[], opts: EditOptions = {}): string | null {
  switch (c.op) {
    case "edit": {
      const row = store.get(c.table, c.id);
      if (!row) return null;
      // A flight with its private values, so an edit that leaves them alone writes them back as they are.
      const cur = c.table === "flights" ? withPrivate(store, row as Row<"flights">) : row;
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
      return left ? t("importer.apply.undoLeft", { count: left }) : null;
    }
    case "family":
      setFamily(store, c.designator, c.familyId);
      return null;
    case "settings":
      updateSettings(store, c.set);
      return null;
    case "view":
      saveView(store, { name: c.name, dataset: c.dataset, rowDimension: c.rowDimension, columnDimension: c.columnDimension, measure: c.measure, ...(c.filters?.length && { filters: c.filters }) });
      return null;
    case "removeView":
      removeView(store, c.id);
      return null;
    case "facts": {
      const out = applyAirframeFacts(store, ref, c.id, c.facts, { overwriteImported: c.overwriteImported });
      return out.mergedInto ? t("importer.apply.merged") : null;
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
