// A change file as its review shows it (docs/34, "The review"), on the Import page and in the terminal: each change
// with what it is about, what it would do (before and after), whether it still has something to do, and the
// findings the changes taken would bring. Worked out on copies of the log, so nothing is written until the import.
// Private values (ticket numbers, booking references) are shown only when the caller asks: the terminal never does.

import { flightDay } from "../derive.ts";
import { refOverridesOf, tagsOf } from "../edit.ts";
import { phasesOf } from "../phases.ts";
import { applyChange, changeStatus, copyStore, currentFindings, type ChangeStatus, type InboxChange } from "../import/changes.ts";
import { airframeFactsEffect } from "../identity/facts.ts";
import { registrationMatchForm } from "../normalise/registration.ts";
import type { RefIndex } from "../ref/index.ts";
import { RULES, type Finding } from "../rules/types.ts";
import { DIMENSIONS } from "../stats/index.ts";
import type { Row, Settings, Track } from "../schema/tables.ts";
import type { Store } from "../store.ts";
import { airportWithCode, type CodeStyle } from "./codes.ts";
import { airlineLabel, CABIN_LABEL, dateTimeLabel, FIELD_LABEL, dayMonthYear, distance, durShort, modelLabel, nf, PHASE_LABEL, REASON_LABEL, TAG_LABEL, TRACK_SOURCE, typeName } from "./format.ts";

export interface PlannedLine {
  field: string;
  label: string;
  before: string;
  after: string;
  private: boolean;
}

export interface PlannedChange {
  index: number;
  change: InboxChange;
  /** "Edit", "Delete", "Aircraft facts", … */
  action: string;
  /** What it is about: "BA9001 · 14 Mar 2025 · LHR → JFK". */
  title: string;
  lines: PlannedLine[];
  status: ChangeStatus;
  note: string | null;
}

export interface ChangePlan {
  changes: PlannedChange[];
  /** Changes with something to do (pending, or changed since and so up to the user). */
  open: number;
  /** Findings the changes taken would bring. */
  findings: Finding[];
}

export interface PlanOptions {
  codes?: CodeStyle;
  unit?: Settings["distanceUnit"];
  models?: Settings["modelNaming"];
  showPrivate?: boolean;
  /** Which changes the user takes; by default the pending ones, not those whose record changed since. */
  take?: (index: number, status: ChangeStatus) => boolean;
}

export const takeByDefault = (_: number, status: ChangeStatus) => status === "pending";

interface Ctx {
  ref: RefIndex;
  store: Store;
  o: PlanOptions;
}

type Show = (r: Record<string, unknown>, x: Ctx) => string;
const text = (k: string): Show => (r) => (r[k] === null || r[k] === undefined ? "" : String(r[k]));
const time = (k: string): Show => (r) => dateTimeLabel(r[k] as string | null);
const typeText: Show = (r, x) => (r.typeCode ? `${typeName(r.typeCode as string, x.ref)} (${r.typeCode as string})` : ((r.typeCodeRaw as string) ?? ""));
const capital = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : "");

/** The fields a review shows, with their labels: one line per field the user knows, not per stored column. */
const FLIGHT_SHOW: [string, string, Show][] = [
  ["scheduledDate", "Date", text("scheduledDate")],
  ["flightNumber", "Flight number", text("flightNumber")],
  ["airline", "Airline", (r, x) => airlineLabel(r.airlineId as string | null, x.ref) || ((r.airlineRaw as string) ?? "")],
  ["operatedBy", "Operated by", (r, x) => airlineLabel(r.operatingAirlineId as string | null, x.ref)],
  ["from", "From", (r, x) => airportWithCode(r.fromAirportId as string | null, x.ref, r.fromRaw as string | null, x.o.codes)],
  ["to", "To", (r, x) => airportWithCode(r.toAirportId as string | null, x.ref, r.toRaw as string | null, x.o.codes)],
  ["divertedTo", "Diverted to", (r, x) => (r.divertedToAirportId ? airportWithCode(r.divertedToAirportId as string, x.ref, null, x.o.codes) : "")],
  ["boardingAt", "Boarding", time("boardingAt")],
  ["departureScheduledAt", "Scheduled departure", time("departureScheduledAt")],
  ["departureAt", "Departure", time("departureAt")],
  ["takeoffAt", "Takeoff", time("takeoffAt")],
  ["landingAt", "Landing", time("landingAt")],
  ["arrivalScheduledAt", "Scheduled arrival", time("arrivalScheduledAt")],
  ["arrivalAt", "Arrival", time("arrivalAt")],
  ["departureTerminal", "Terminal", text("departureTerminal")],
  ["departureGate", "Gate", text("departureGate")],
  ["arrivalTerminal", "Arrival terminal", text("arrivalTerminal")],
  ["arrivalGate", "Arrival gate", text("arrivalGate")],
  ["seat", "Seat", text("seat")],
  ["seatPosition", "Seat position", (r) => capital((r.seatPosition as string) ?? "")],
  ["cabinClass", "Cabin", (r) => (r.cabinClass ? (CABIN_LABEL[r.cabinClass as string] ?? String(r.cabinClass)) : "")],
  ["bookingClass", "Booking class", text("bookingClass")],
  ["fareBrand", "Fare", text("fareBrand")],
  ["reason", "Reason", (r) => (r.reason ? (REASON_LABEL[r.reason as string] ?? String(r.reason)) : "")],
  ["registration", "Registration", (r) => ((r.registration ?? r.registrationRaw ?? "") as string)],
  ["typeCode", "Type", typeText],
  ["model", "Model", (r, x) => (r.model ? modelLabel(r.model as string, r.typeCode as string | null, x.ref, x.o.models) : ((r.modelRaw as string) ?? ""))],
  ["livery", "Livery", text("livery")],
  ["specialLivery", "Special livery", text("specialLivery")],
  ["distanceKmOverride", "Distance", (r, x) => (r.distanceKmOverride === null || r.distanceKmOverride === undefined ? "" : distance(r.distanceKmOverride as number, x.o.unit))],
  ["durationMinOverride", "Duration", (r) => (r.durationMinOverride === null || r.durationMinOverride === undefined ? "" : durShort(r.durationMinOverride as number))],
  ["notes", "Notes", text("notes")],
  ["ticketNumber", "Ticket number", text("ticketNumber")],
  ["bookingRef", "Booking reference", text("bookingRef")],
];

const SIGHTING_SHOW: [string, string, Show][] = [
  ["seenOn", "Date", text("seenOn")],
  ["seenAt", "Time", time("seenAt")],
  ["airport", "Airport", (r, x) => airportWithCode(r.airportId as string | null, x.ref, r.airportRaw as string | null, x.o.codes)],
  ["spotName", "Spot", text("spotName")],
  ["position", "Position", (r) => (typeof r.lat === "number" && typeof r.lon === "number" ? `${r.lat}, ${r.lon}` : "")],
  ["registration", "Registration", (r) => ((r.registration ?? r.registrationRaw ?? "") as string)],
  ["airline", "Airline", (r, x) => airlineLabel(r.operatorId as string | null, x.ref) || ((r.operatorRaw as string) ?? "")],
  ["typeCode", "Type", typeText],
  ["model", "Model", (r, x) => (r.model ? modelLabel(r.model as string, r.typeCode as string | null, x.ref, x.o.models) : ((r.modelRaw as string) ?? ""))],
  // Every status, as the review read it (rowOf).
  ["phase", "Phase", (r) => ((r.phases as string[] | undefined) ?? (r.phase ? [r.phase as string] : [])).map((p) => PHASE_LABEL[p] ?? p).join(", ")],
  ["livery", "Livery", text("livery")],
  ["specialLivery", "Special livery", text("specialLivery")],
  ["photoCount", "Photos", text("photoCount")],
  ["notes", "Notes", text("notes")],
  // The tags travel with the row as the review read it (rowOf).
  ["tags", "Tags", (r) => ((r.tags as string[] | undefined) ?? []).map((t) => TAG_LABEL[t] ?? t).sort().join(", ")],
];

const AIRFRAME_SHOW: [string, string, Show][] = [
  ["manufacturer", "Manufacturer", text("manufacturer")],
  ["msn", "Serial number", text("msn")],
  ["lineNumber", "Line number", text("lineNumber")],
  ["typeCode", "Type", typeText],
  ["model", "Model", text("model")],
  ["firstFlightDate", "First flight", text("firstFlightDate")],
  ["deliveryDate", "Delivered", text("deliveryDate")],
  ["status", "Status", (r) => capital(((r.status as string) ?? "").replace(/_/g, " "))],
  ["notes", "Notes", text("notes")],
];

const PRIVATE = new Set(["ticketNumber", "bookingRef"]);

/** The change with its private values left out, for a review that does not show them. */
function masked(c: InboxChange): InboxChange {
  if (c.op !== "edit" || !Object.keys(c.set).some((k) => PRIVATE.has(k))) return c;
  return { ...c, set: Object.fromEntries(Object.entries(c.set).map(([k, v]) => [k, PRIVATE.has(k) && v !== null ? "(private)" : v])) };
}

/** The transponder address the log keeps for a registration, as the review shows it. */
const hexOf = (store: Store, registration: string): string | null => {
  const reg = registrationMatchForm(registration);
  return store.all("registration_periods").find((p) => p.icaoHex && registrationMatchForm(p.registration ?? "") === reg)?.icaoHex?.toUpperCase() ?? null;
};

function lines(show: [string, string, Show][], before: Record<string, unknown> | null, beforeCtx: Ctx, after: Record<string, unknown> | null, afterCtx: Ctx): PlannedLine[] {
  const out: PlannedLine[] = [];
  for (const [field, label, fn] of show) {
    const b = before ? fn(before, beforeCtx) : "";
    const a = after ? fn(after, afterCtx) : "";
    if (b === a) continue;
    const isPrivate = PRIVATE.has(field);
    if (isPrivate && !beforeCtx.o.showPrivate) out.push({ field, label, before: b ? "recorded" : "", after: !a ? "removed" : b ? "changed" : "added", private: true });
    else out.push({ field, label, before: b, after: a, private: isPrivate });
  }
  return out;
}

/** The stored fields a change sets or clears, by their labels in FIELD_LABEL, before → after. */
function storedLines(before: Record<string, unknown> | null, after: Record<string, unknown> | null, fields: string[], o: PlanOptions): PlannedLine[] {
  const value = (r: Record<string, unknown> | null, k: string) => (r?.[k] === null || r?.[k] === undefined ? "" : String(r[k]));
  const out: PlannedLine[] = [];
  for (const k of new Set(fields)) {
    const [b, a] = [value(before, k), value(after, k)];
    if (b === a) continue;
    const isPrivate = PRIVATE.has(k);
    if (isPrivate && !o.showPrivate) out.push({ field: k, label: FIELD_LABEL[k] ?? k, before: b ? "recorded" : "", after: !a ? "removed" : b ? "changed" : "added", private: true });
    else out.push({ field: k, label: FIELD_LABEL[k] ?? k, before: b, after: a, private: isPrivate });
  }
  return out;
}

/** "BA9001 · 14 Mar 2025 · LHR → JFK", "G-ABCD at EGLL on 15 Mar 2025". */
export function recordTitle(store: Store, ref: RefIndex, table: "flights" | "sightings", id: string, codes: CodeStyle = "iata"): string {
  const r = store.peek(table, id);
  if (!r) return table === "flights" ? "A flight no longer in the log" : "A sighting no longer in the log";
  const code = (airportId: string | null, raw: string | null) => {
    const a = ref.airport(airportId);
    return (a ? (codes === "icao" ? (a.icao ?? a.iata) : (a.iata ?? a.icao)) : raw) ?? "?";
  };
  if (table === "flights") {
    const f = r as Row<"flights">;
    const day = flightDay(f) ?? f.scheduledDate;
    return [f.flightNumber ?? "Flight", day && dayMonthYear(day), `${code(f.fromAirportId, f.fromRaw)} → ${code(f.divertedToAirportId ?? f.toAirportId, f.toRaw)}`].filter(Boolean).join(" · ");
  }
  const s = r as Row<"sightings">;
  return [s.registration ?? s.registrationRaw ?? "Sighting", (s.airportId || s.airportRaw) && `at ${code(s.airportId, s.airportRaw)}`, s.seenOn && `on ${dayMonthYear(s.seenOn)}`].filter(Boolean).join(" ");
}

/** "N9001Z · Airbus A321neo · serial 1234". */
export function aircraftTitle(store: Store, ref: RefIndex, id: string): string {
  const a = store.peek("airframes", id);
  if (!a) return "An aircraft no longer in the log";
  const reg =
    store.all("registration_periods").find((p) => p.airframeId === id)?.registration ??
    [...store.all("flights"), ...store.all("sightings")].find((r) => r.airframeId === id)?.registration ??
    null;
  return [reg, a.typeCode && typeName(a.typeCode, ref), a.msn && `serial ${a.msn}`].filter(Boolean).join(" · ") || "An aircraft";
}

const ACTION: Record<InboxChange["op"], string> = {
  edit: "Edit",
  delete: "Delete",
  airframe: "Aircraft facts",
  merge: "Merge aircraft",
  accept: "This is right",
  reopen: "Reopen",
  fix: "Suggested fix",
  undo: "Undo an import",
  family: "Aircraft family",
  settings: "Settings",
  view: "Save a view",
  removeView: "Remove a view",
  facts: "Looked-up facts",
  track: "Recorded track",
  removeTrack: "Remove the recorded track",
};

/** A flight's recorded track, line by line, beside the one replacing it. */
function trackLines(before: Track | null, after: Track | null, o: PlanOptions): PlannedLine[] {
  const span = (t: Track) => (t.firstPointAt && t.lastPointAt ? `${t.firstPointAt.slice(0, 16).replace("T", " ")} to ${t.lastPointAt.slice(11, 16)} UTC` : "");
  const rows: [string, string, (t: Track) => string][] = [
    ["coverage", "Coverage", (t) => (t.coverage === "partial" ? "Partial" : "Complete")],
    ["points", "Points", (t) => nf.format(t.pointCount ?? 0)],
    ["distance", "Distance", (t) => (t.distanceKm === null ? "" : distance(t.distanceKm, o.unit))],
    ["times", "Recorded", span],
    ["provider", "From", (t) => (t.provider ? (TRACK_SOURCE[t.provider] ?? t.provider) : "")],
  ];
  return rows.map(([field, label, value]) => ({ field, label, before: before ? value(before) : "", after: after ? value(after) : "", private: false }));
}

const PROVIDER_LABEL: Record<string, string> = { opensky: "OpenSky", adsbdb: "adsbdb", fr24: "Flightradar24" };

const MEASURE_LABEL: Record<string, string> = { records: "Number of records", aircraft: "Aircraft (each once)", distance: "Distance", time: "Time in the air" };

/** A saved Statistics view's settings as the Custom tab names them. */
function viewLines(v: { dataset: string | null; rowDimension: string | null; columnDimension: string | null; measure: string | null }, side: "before" | "after"): PlannedLine[] {
  const dim = (id: string | null) => (id ? (DIMENSIONS.find((d) => d.id === id)?.label ?? id) : "Nothing");
  const count = v.measure === "records" ? (v.dataset === "flights" ? "Number of flights" : "Number of sightings") : (MEASURE_LABEL[v.measure ?? ""] ?? v.measure ?? "");
  const rows: [string, string, string][] = [
    ["dataset", "From", v.dataset === "flights" ? "Flights" : "Sightings"],
    ["measure", "Count", count],
    ["rowDimension", "Group by", dim(v.rowDimension)],
    ["columnDimension", "Split by", dim(v.columnDimension)],
  ];
  return rows.map(([field, label, value]) => ({ field, label, before: side === "before" ? value : "", after: side === "after" ? value : "", private: false }));
}

const SETTING_LABEL: Record<string, [string, Record<string, string>]> = {
  codeDisplay: ["Codes", { iata: "IATA", icao: "ICAO", both: "Both" }],
  distanceUnit: ["Distance", { km: "Kilometres", mi: "Miles", nm: "Nautical miles" }],
  modelNaming: ["Model names", { standard: "Standard", compact: "Compact" }],
};

/** The plan of a change file against the log as it is now. */
export function planChanges(store: Store, ref: RefIndex, changes: InboxChange[], o: PlanOptions = {}): ChangePlan {
  const take = o.take ?? takeByDefault;
  // One copy shows what each change does in turn; another holds only the changes taken, for their findings.
  const shown = copyStore(store);
  const taken = copyStore(store);
  const findingsOf = (s: Store) => {
    let cached: Finding[] | null = null;
    return { get: () => (cached ??= currentFindings(s, ref)), reset: () => (cached = null) };
  };
  const onShown = findingsOf(shown);
  const onTaken = findingsOf(taken);
  const baseline = new Set(onTaken.get().map((f) => `${f.ruleId}|${f.fingerprint}`));
  const ctx = (s: Store): Ctx => ({ ref, store: s, o });
  const planned: PlannedChange[] = [];

  try {
    changes.forEach((c, index) => {
      // As the import goes: in order, after the changes taken before this one.
      const { status, note } = changeStatus(taken, ref, c, onTaken.get);
      const p: PlannedChange = { index, change: o.showPrivate ? c : masked(c), action: ACTION[c.op], title: "", lines: [], status, note };
      const active = status === "pending" || status === "changed";
      // What the change is about, and the rows it touches, before it.
      const rowOf = (table: "flights" | "sightings" | "airframes", id: string) => {
        const r = shown.peek(table, id);
        if (!r || (r as { deleted?: boolean }).deleted) return null;
        return { ...r, ...(table === "sightings" && { tags: tagsOf(shown, id), phases: phasesOf(shown, id) }) } as Record<string, unknown>;
      };
      let before: Record<string, unknown> | null = null;
      let mergedInto: string | null = null;
      let hexBefore: string | null = null;
      const trackOf = (flightId: string) => shown.all("tracks").find((t) => t.flightId === flightId) ?? null;
      let trackBefore: Track | null = null;
      switch (c.op) {
        case "edit":
        case "delete":
          p.title = recordTitle(shown, ref, c.table, c.id, o.codes);
          before = rowOf(c.table, c.id);
          break;
        case "track":
        case "removeTrack":
          p.title = recordTitle(shown, ref, "flights", c.flightId, o.codes);
          trackBefore = trackOf(c.flightId);
          break;
        case "airframe":
          p.title = aircraftTitle(shown, ref, c.id);
          before = rowOf("airframes", c.id);
          break;
        case "facts":
          p.title = aircraftTitle(shown, ref, c.id);
          before = rowOf("airframes", c.id);
          hexBefore = hexOf(shown, c.facts.registration);
          if (active) mergedInto = airframeFactsEffect(shown, ref, c.id, c.facts, { overwriteImported: c.overwriteImported }).mergedInto;
          break;
        case "merge": {
          const moving = [...shown.all("flights"), ...shown.all("sightings")].filter((r) => r.airframeId === c.from).length;
          p.title = `${aircraftTitle(shown, ref, c.from)} into ${aircraftTitle(shown, ref, c.into)}`;
          if (active) p.lines.push({ field: "records", label: "Records moved", before: "", after: String(moving), private: false });
          break;
        }
        case "accept":
        case "fix": {
          const f = onShown.get().find((x) => x.ruleId === c.ruleId && x.fingerprint === c.fingerprint);
          p.title = `${RULES[c.ruleId]?.title ?? c.ruleId}${f ? `: ${f.message}` : ""}`;
          if (c.op === "accept" && c.note) p.lines.push({ field: "note", label: "Note", before: "", after: c.note, private: false });
          if (c.op === "fix" && f?.fixes[c.fix]) p.lines.push({ field: "fix", label: "Fix", before: "", after: f.fixes[c.fix]!.label, private: false });
          break;
        }
        case "reopen": {
          const ack = shown.peek("issue_acks", c.ackId);
          p.title = ack?.ruleId ? (RULES[ack.ruleId]?.title ?? ack.ruleId) : "An accepted finding";
          if (ack?.note) p.lines.push({ field: "note", label: "Note", before: ack.note, after: "", private: false });
          break;
        }
        case "undo": {
          const b = shown.peek("import_batches", c.batchId);
          p.title = b ? `${b.fileName ?? "An import"}${b.createdAt ? `, ${dayMonthYear(b.createdAt.slice(0, 10))}` : ""}` : "An import no longer in the log";
          if (b && active) p.lines.push({ field: "rows", label: b.mappingPreset === "touchdown_changes" ? "Changes made" : "Rows imported", before: String(b.rowsAccepted ?? 0), after: "undone", private: false });
          if (b && active && c.force) p.lines.push({ field: "force", label: "Records changed since", before: "", after: "undone too, losing those changes", private: false });
          break;
        }
        case "family": {
          p.title = `${typeName(c.designator, ref)} (${c.designator})`;
          const now = shown.all("family_overrides").find((x) => x.designator === c.designator)?.familyId ?? ref.types.get(c.designator)?.familyId ?? null;
          const after = c.familyId ?? ref.types.get(c.designator)?.familyId ?? null;
          p.lines.push({ field: "family", label: "Family", before: (now && ref.family(now)?.name) ?? now ?? "", after: (after && ref.family(after)?.name) ?? after ?? "", private: false });
          break;
        }
        case "view":
          p.title = `“${c.name}”`;
          p.lines = viewLines(c, "after");
          break;
        case "removeView": {
          const v = shown.peek("saved_views", c.id);
          p.title = v?.name ? `“${v.name}”` : "A saved view";
          if (v && !(v as { deleted?: boolean }).deleted) p.lines = viewLines(v, "before");
          break;
        }
        case "settings": {
          p.title = "Settings kept in the log";
          const cur = (shown.get("settings", "settings") ?? {}) as Record<string, unknown>;
          for (const [k, v] of Object.entries(c.set)) {
            const [label, names] = SETTING_LABEL[k]!;
            const b = (cur[k] as string | null) ?? null;
            if (b !== v) p.lines.push({ field: k, label, before: b ? (names[b] ?? b) : "", after: names[v as string] ?? String(v), private: false });
          }
          break;
        }
      }
      if (active) {
        // What the change says it did beyond itself (a named operator added, records an undo left) is its note.
        const said = applyChange(shown, ref, c, onShown.get);
        if (said) p.note = said;
        onShown.reset();
        if (take(index, status)) {
          applyChange(taken, ref, c, onTaken.get);
          onTaken.reset();
        }
      }
      if (active && (c.op === "edit" || c.op === "airframe")) {
        const table = c.op === "edit" ? c.table : "airframes";
        const after = rowOf(table, c.id);
        const show = table === "flights" ? FLIGHT_SHOW : table === "sightings" ? SIGHTING_SHOW : AIRFRAME_SHOW;
        p.lines = lines(show, before, ctx(shown), after, ctx(shown));
        // A field none of those lines shows (one added later, a value as typed): named as stored, so a change never shows nothing.
        if (!p.lines.length) p.lines = storedLines(before, after, [...Object.keys(c.set), ...c.clear], o);
      }
      if (active && c.op === "facts") {
        // Merged, the facts went on the other aircraft: shown on it.
        const hexAfter = hexOf(shown, c.facts.registration);
        const hexLine: PlannedLine[] = hexAfter !== hexBefore ? [{ field: "icaoHex", label: "Transponder address", before: hexBefore ?? "", after: hexAfter ?? "", private: false }] : [];
        p.lines = [...lines(AIRFRAME_SHOW, before, ctx(shown), rowOf("airframes", mergedInto ?? c.id), ctx(shown)), ...hexLine, { field: "provider", label: "Source", before: "", after: PROVIDER_LABEL[c.facts.provider] ?? c.facts.provider, private: false }];
      }
      if (active && (c.op === "track" || c.op === "removeTrack")) p.lines = trackLines(trackBefore, trackOf(c.flightId), o);
      if (active && c.op === "delete" && before) p.lines = lines(c.table === "flights" ? FLIGHT_SHOW.slice(0, 5) : SIGHTING_SHOW.slice(0, 5), before, ctx(shown), null, ctx(shown)).map((l) => ({ ...l, after: "" }));
      planned.push(p);
    });
    const acked = new Set(store.all("issue_acks").map((a) => `${a.ruleId}|${a.fingerprint}`));
    const findings = onTaken.get().filter((f) => !baseline.has(`${f.ruleId}|${f.fingerprint}`) && !acked.has(`${f.ruleId}|${f.fingerprint}`));
    return { changes: planned, open: planned.filter((p) => p.status === "pending" || p.status === "changed").length, findings };
  } finally {
    // Operators written by name may have been added to the index on the copies; it goes back to the log's own.
    ref.setUserOverrides(refOverridesOf(store));
  }
}
