// A change file as its review shows it (docs/34, "The review"), on the Import page and in the terminal: each change
// with what it is about, what it would do (before and after), whether it still has something to do, and the
// findings the changes taken would bring. Worked out on copies of the log, so nothing is written until the import.
// Private values (ticket numbers, booking references) are shown only when the caller asks: the terminal never does.

import { has, t, tDynamic, type MessageKey } from "@touchdown/i18n";
import { flightDay } from "../derive.ts";
import { refOverridesOf, tagsOf, viewFilters } from "../edit.ts";
import { phasesOf } from "../phases.ts";
import { withPrivate } from "../private.ts";
import { applyChange, changeStatus, copyStore, currentFindings, type ChangeStatus, type InboxChange } from "../import/changes.ts";
import { airframeFactsEffect } from "../identity/facts.ts";
import { registrationMatchForm } from "../normalise/registration.ts";
import type { RefIndex } from "../ref/index.ts";
import { RULES, type Finding } from "../rules/types.ts";
import { DIMENSIONS, type PivotFilter } from "../stats/index.ts";
import type { Row, Settings, Track } from "../schema/tables.ts";
import type { Store } from "../store.ts";
import { airportWithCode, type CodeStyle } from "./codes.ts";
import { filtersText, seatPositionLabel } from "./pivot.ts";
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
/** A line the review shows: the field, its label's message, and how its value is shown. */
type ShowLine = [string, MessageKey, Show];
const text = (k: string): Show => (r) => (r[k] === null || r[k] === undefined ? "" : String(r[k]));
const time = (k: string): Show => (r) => dateTimeLabel(r[k] as string | null);
const typeText: Show = (r, x) => (r.typeCode ? `${typeName(r.typeCode as string, x.ref)} (${r.typeCode as string})` : ((r.typeCodeRaw as string) ?? ""));
const capital = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : "");
/** "Written off": an aircraft's status as a word. A status with no message is shown as stored, in words. */
const statusText = (s: string) => (has(`view.airframeStatus.${s}`) ? tDynamic(`view.airframeStatus.${s}`) : capital(s.replace(/_/g, " ")));

/** The fields a review shows, with their labels: one line per field the user knows, not per stored column. */
const FLIGHT_SHOW: ShowLine[] = [
  ["scheduledDate", "labels.field.scheduledDate", text("scheduledDate")],
  ["flightNumber", "labels.field.flightNumber", text("flightNumber")],
  ["airline", "labels.field.airlineId", (r, x) => airlineLabel(r.airlineId as string | null, x.ref) || ((r.airlineRaw as string) ?? "")],
  ["operatedBy", "labels.field.operatingAirlineId", (r, x) => airlineLabel(r.operatingAirlineId as string | null, x.ref)],
  ["from", "labels.field.fromAirportId", (r, x) => airportWithCode(r.fromAirportId as string | null, x.ref, r.fromRaw as string | null, x.o.codes)],
  ["to", "labels.field.toAirportId", (r, x) => airportWithCode(r.toAirportId as string | null, x.ref, r.toRaw as string | null, x.o.codes)],
  ["divertedTo", "labels.field.divertedToAirportId", (r, x) => (r.divertedToAirportId ? airportWithCode(r.divertedToAirportId as string, x.ref, null, x.o.codes) : "")],
  ["boardingAt", "labels.field.boardingAt", time("boardingAt")],
  ["departureScheduledAt", "labels.field.departureScheduledAt", time("departureScheduledAt")],
  ["departureAt", "labels.field.departureAt", time("departureAt")],
  ["takeoffAt", "labels.field.takeoffAt", time("takeoffAt")],
  ["landingAt", "labels.field.landingAt", time("landingAt")],
  ["arrivalScheduledAt", "labels.field.arrivalScheduledAt", time("arrivalScheduledAt")],
  ["arrivalAt", "labels.field.arrivalAt", time("arrivalAt")],
  ["departureTerminal", "labels.field.departureTerminal", text("departureTerminal")],
  ["departureGate", "labels.field.departureGate", text("departureGate")],
  ["arrivalTerminal", "labels.field.arrivalTerminal", text("arrivalTerminal")],
  ["arrivalGate", "labels.field.arrivalGate", text("arrivalGate")],
  ["seat", "labels.field.seat", text("seat")],
  ["seatPosition", "labels.field.seatPosition", (r) => (r.seatPosition ? seatPositionLabel(r.seatPosition as string) : "")],
  ["cabinClass", "labels.field.cabinClass", (r) => (r.cabinClass ? (CABIN_LABEL[r.cabinClass as string] ?? String(r.cabinClass)) : "")],
  ["bookingClass", "labels.field.bookingClass", text("bookingClass")],
  ["fareBrand", "labels.field.fareBrand", text("fareBrand")],
  ["reason", "labels.field.reason", (r) => (r.reason ? (REASON_LABEL[r.reason as string] ?? String(r.reason)) : "")],
  ["registration", "labels.field.registration", (r) => ((r.registration ?? r.registrationRaw ?? "") as string)],
  ["typeCode", "changes.field.type", typeText],
  ["model", "labels.field.model", (r, x) => (r.model ? modelLabel(r.model as string, r.typeCode as string | null, x.ref, x.o.models) : ((r.modelRaw as string) ?? ""))],
  ["livery", "labels.field.livery", text("livery")],
  ["specialLivery", "labels.field.specialLivery", text("specialLivery")],
  ["distanceKmOverride", "changes.field.distance", (r, x) => (r.distanceKmOverride === null || r.distanceKmOverride === undefined ? "" : distance(r.distanceKmOverride as number, x.o.unit))],
  ["durationMinOverride", "changes.field.duration", (r) => (r.durationMinOverride === null || r.durationMinOverride === undefined ? "" : durShort(r.durationMinOverride as number))],
  ["notes", "labels.field.notes", text("notes")],
  ["ticketNumber", "labels.field.ticketNumber", text("ticketNumber")],
  ["bookingRef", "labels.field.bookingRef", text("bookingRef")],
];

const SIGHTING_SHOW: ShowLine[] = [
  ["seenOn", "labels.field.seenOn", text("seenOn")],
  ["seenAt", "labels.field.seenAt", time("seenAt")],
  ["airport", "labels.field.airportId", (r, x) => airportWithCode(r.airportId as string | null, x.ref, r.airportRaw as string | null, x.o.codes)],
  ["spotName", "labels.field.spotName", text("spotName")],
  ["position", "changes.field.position", (r) => (typeof r.lat === "number" && typeof r.lon === "number" ? `${r.lat}, ${r.lon}` : "")],
  ["registration", "labels.field.registration", (r) => ((r.registration ?? r.registrationRaw ?? "") as string)],
  ["airline", "labels.field.operatorId", (r, x) => airlineLabel(r.operatorId as string | null, x.ref) || ((r.operatorRaw as string) ?? "")],
  ["typeCode", "changes.field.type", typeText],
  ["model", "labels.field.model", (r, x) => (r.model ? modelLabel(r.model as string, r.typeCode as string | null, x.ref, x.o.models) : ((r.modelRaw as string) ?? ""))],
  // Every status, as the review read it (rowOf).
  ["phase", "labels.field.phase", (r) => ((r.phases as string[] | undefined) ?? (r.phase ? [r.phase as string] : [])).map((p) => PHASE_LABEL[p] ?? p).join(", ")],
  ["livery", "labels.field.livery", text("livery")],
  ["specialLivery", "labels.field.specialLivery", text("specialLivery")],
  ["photoCount", "labels.field.photoCount", text("photoCount")],
  ["notes", "labels.field.notes", text("notes")],
  // The tags travel with the row as the review read it (rowOf).
  ["tags", "changes.field.tags", (r) => ((r.tags as string[] | undefined) ?? []).map((t) => TAG_LABEL[t] ?? t).sort().join(", ")],
];

const AIRFRAME_SHOW: ShowLine[] = [
  ["manufacturer", "changes.field.manufacturer", text("manufacturer")],
  ["msn", "changes.field.msn", text("msn")],
  ["lineNumber", "changes.field.lineNumber", text("lineNumber")],
  ["typeCode", "changes.field.type", typeText],
  ["model", "labels.field.model", text("model")],
  ["firstFlightDate", "changes.field.firstFlightDate", text("firstFlightDate")],
  ["deliveryDate", "changes.field.deliveryDate", text("deliveryDate")],
  ["status", "changes.field.status", (r) => (r.status ? statusText(r.status as string) : "")],
  ["notes", "labels.field.notes", text("notes")],
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

/** A private value's line as a review that does not show it gives it: "recorded" before, "changed" after. */
function hiddenLine(field: string, label: string, b: string, a: string): PlannedLine {
  return { field, label, before: b ? t("changes.private.recorded") : "", after: !a ? t("changes.private.removed") : b ? t("changes.private.changed") : t("changes.private.added"), private: true };
}

function lines(show: ShowLine[], before: Record<string, unknown> | null, beforeCtx: Ctx, after: Record<string, unknown> | null, afterCtx: Ctx): PlannedLine[] {
  const out: PlannedLine[] = [];
  for (const [field, labelKey, fn] of show) {
    const b = before ? fn(before, beforeCtx) : "";
    const a = after ? fn(after, afterCtx) : "";
    if (b === a) continue;
    const label = t(labelKey);
    const isPrivate = PRIVATE.has(field);
    if (isPrivate && !beforeCtx.o.showPrivate) out.push(hiddenLine(field, label, b, a));
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
    if (isPrivate && !o.showPrivate) out.push(hiddenLine(k, FIELD_LABEL[k] ?? k, b, a));
    else out.push({ field: k, label: FIELD_LABEL[k] ?? k, before: b, after: a, private: isPrivate });
  }
  return out;
}

/** "BA9001 · 14 Mar 2025 · LHR → JFK", "G-ABCD at EGLL on 15 Mar 2025". */
export function recordTitle(store: Store, ref: RefIndex, table: "flights" | "sightings", id: string, codes: CodeStyle = "iata"): string {
  const r = store.peek(table, id);
  if (!r) return t("changes.title.recordGone", { table });
  const code = (airportId: string | null, raw: string | null) => {
    const a = ref.airport(airportId);
    return (a ? (codes === "icao" ? (a.icao ?? a.iata) : (a.iata ?? a.icao)) : raw) ?? "?";
  };
  if (table === "flights") {
    const f = r as Row<"flights">;
    const day = flightDay(f) ?? f.scheduledDate;
    return [f.flightNumber ?? t("changes.title.flight"), day && dayMonthYear(day), `${code(f.fromAirportId, f.fromRaw)} → ${code(f.divertedToAirportId ?? f.toAirportId, f.toRaw)}`].filter(Boolean).join(" · ");
  }
  const s = r as Row<"sightings">;
  const at = s.airportId || s.airportRaw ? code(s.airportId, s.airportRaw) : "";
  const where = at && s.seenOn ? "airportAndDay" : at ? "airport" : s.seenOn ? "day" : "none";
  return t("changes.title.sightingAt", { where, name: s.registration ?? s.registrationRaw ?? t("changes.title.sighting"), airport: at, day: s.seenOn ? dayMonthYear(s.seenOn) : "" });
}

/** "N9001Z · Airbus A321neo · serial 1234". */
export function aircraftTitle(store: Store, ref: RefIndex, id: string): string {
  const a = store.peek("airframes", id);
  if (!a) return t("changes.title.aircraftGone");
  const reg =
    store.all("registration_periods").find((p) => p.airframeId === id)?.registration ??
    [...store.all("flights"), ...store.all("sightings")].find((r) => r.airframeId === id)?.registration ??
    null;
  return [reg, a.typeCode && typeName(a.typeCode, ref), a.msn && t("changes.title.serial", { msn: a.msn })].filter(Boolean).join(" · ") || t("changes.title.aircraft");
}

const ACTION: Record<InboxChange["op"], MessageKey> = {
  edit: "changes.action.edit",
  delete: "changes.action.delete",
  airframe: "changes.action.airframe",
  merge: "changes.action.merge",
  accept: "changes.action.accept",
  reopen: "changes.action.reopen",
  fix: "changes.action.fix",
  undo: "changes.action.undo",
  family: "changes.action.family",
  settings: "changes.action.settings",
  view: "changes.action.view",
  removeView: "changes.action.removeView",
  facts: "changes.action.facts",
  track: "changes.action.track",
  removeTrack: "changes.action.removeTrack",
};

/** A flight's recorded track, line by line, beside the one replacing it. */
function trackLines(before: Track | null, after: Track | null, o: PlanOptions): PlannedLine[] {
  const span = (k: Track) => (k.firstPointAt && k.lastPointAt ? t("changes.track.span", { from: k.firstPointAt.slice(0, 16).replace("T", " "), to: k.lastPointAt.slice(11, 16) }) : "");
  const rows: [string, string, (k: Track) => string][] = [
    ["coverage", t("changes.track.coverage"), (k) => (k.coverage === "partial" ? t("changes.track.partial") : t("changes.track.complete"))],
    ["points", t("changes.track.points"), (k) => nf.format(k.pointCount ?? 0)],
    ["distance", t("changes.field.distance"), (k) => (k.distanceKm === null ? "" : distance(k.distanceKm, o.unit))],
    ["times", t("changes.track.recorded"), span],
    ["provider", t("changes.track.provider"), (k) => (k.provider ? (TRACK_SOURCE[k.provider] ?? k.provider) : "")],
  ];
  return rows.map(([field, label, value]) => ({ field, label, before: before ? value(before) : "", after: after ? value(after) : "", private: false }));
}

const PROVIDER_LABEL: Record<string, string> = { opensky: "OpenSky", adsbdb: "adsbdb", fr24: "Flightradar24" };

/** The names of the measures. A count of records is named by its dataset: "Number of flights". */
const MEASURE_LABEL: Record<string, MessageKey> = { aircraft: "changes.view.measureAircraft", distance: "changes.view.measureDistance", time: "changes.view.measureTime" };

/** A saved Statistics view's settings as the Custom tab names them. */
function viewLines(v: { dataset: string | null; rowDimension: string | null; columnDimension: string | null; measure: string | null }, filters: PivotFilter[], ref: RefIndex, side: "before" | "after"): PlannedLine[] {
  const dim = (id: string | null) => (id ? (DIMENSIONS.find((d) => d.id === id)?.label ?? id) : t("changes.view.nothing"));
  const measure = MEASURE_LABEL[v.measure ?? ""];
  const count = v.measure === "records" ? t("changes.view.measureRecords", { dataset: v.dataset ?? "" }) : measure ? t(measure) : (v.measure ?? "");
  const rows: [string, string, string][] = [
    ["dataset", t("changes.view.dataset"), t("changes.view.datasetName", { dataset: v.dataset ?? "" })],
    ["measure", t("changes.view.measure"), count],
    ["rowDimension", t("changes.view.rowDimension"), dim(v.rowDimension)],
    ["columnDimension", t("changes.view.columnDimension"), dim(v.columnDimension)],
    ...(filters.length ? [["filters", t("changes.view.filters"), filtersText(filters, ref)] as [string, string, string]] : []),
  ];
  return rows.map(([field, label, value]) => ({ field, label, before: side === "before" ? value : "", after: side === "after" ? value : "", private: false }));
}

/** The settings a change file may set, with the names of their values, as Settings gives them. */
const SETTING_LABEL: Record<string, () => [string, Record<string, string>]> = {
  codeDisplay: () => [t("changes.setting.codeDisplay"), { iata: "IATA", icao: "ICAO", both: t("changes.settingValue.both") }],
  distanceUnit: () => [t("changes.setting.distanceUnit"), { km: t("changes.settingValue.km"), mi: t("changes.settingValue.mi"), nm: t("changes.settingValue.nm") }],
  modelNaming: () => [t("changes.setting.modelNaming"), { standard: t("changes.settingValue.standard"), compact: t("changes.settingValue.compact") }],
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
      const p: PlannedChange = { index, change: o.showPrivate ? c : masked(c), action: t(ACTION[c.op]), title: "", lines: [], status, note };
      const active = status === "pending" || status === "changed";
      // What the change is about, and the rows it touches, before it.
      const rowOf = (table: "flights" | "sightings" | "airframes", id: string) => {
        const r = shown.peek(table, id);
        if (!r || (r as { deleted?: boolean }).deleted) return null;
        if (table === "flights") return withPrivate(shown, r as Row<"flights">) as unknown as Record<string, unknown>;
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
          p.title = t("changes.title.merge", { from: aircraftTitle(shown, ref, c.from), into: aircraftTitle(shown, ref, c.into) });
          if (active) p.lines.push({ field: "records", label: t("changes.field.recordsMoved"), before: "", after: String(moving), private: false });
          break;
        }
        case "accept":
        case "fix": {
          const f = onShown.get().find((x) => x.ruleId === c.ruleId && x.fingerprint === c.fingerprint);
          p.title = `${RULES[c.ruleId]?.title ?? c.ruleId}${f ? `: ${f.message}` : ""}`;
          if (c.op === "accept" && c.note) p.lines.push({ field: "note", label: t("changes.field.note"), before: "", after: c.note, private: false });
          if (c.op === "fix" && f?.fixes[c.fix]) p.lines.push({ field: "fix", label: t("changes.field.fix"), before: "", after: f.fixes[c.fix]!.label, private: false });
          break;
        }
        case "reopen": {
          const ack = shown.peek("issue_acks", c.ackId);
          p.title = ack?.ruleId ? (RULES[ack.ruleId]?.title ?? ack.ruleId) : t("changes.title.findingAccepted");
          if (ack?.note) p.lines.push({ field: "note", label: t("changes.field.note"), before: ack.note, after: "", private: false });
          break;
        }
        case "undo": {
          const b = shown.peek("import_batches", c.batchId);
          p.title = b ? `${b.fileName ?? t("changes.title.import")}${b.createdAt ? `, ${dayMonthYear(b.createdAt.slice(0, 10))}` : ""}` : t("changes.title.importGone");
          if (b && active) p.lines.push({ field: "rows", label: b.mappingPreset === "touchdown_changes" ? t("changes.field.changesMade") : t("changes.field.rowsImported"), before: String(b.rowsAccepted ?? 0), after: t("changes.undo.undone"), private: false });
          if (b && active && c.force) p.lines.push({ field: "force", label: t("changes.field.changedSince"), before: "", after: t("changes.undo.undoneToo"), private: false });
          break;
        }
        case "family": {
          p.title = `${typeName(c.designator, ref)} (${c.designator})`;
          const now = shown.all("family_overrides").find((x) => x.designator === c.designator)?.familyId ?? ref.types.get(c.designator)?.familyId ?? null;
          const after = c.familyId ?? ref.types.get(c.designator)?.familyId ?? null;
          p.lines.push({ field: "family", label: t("changes.field.family"), before: (now && ref.family(now)?.name) ?? now ?? "", after: (after && ref.family(after)?.name) ?? after ?? "", private: false });
          break;
        }
        case "view":
          p.title = t("changes.title.view", { name: c.name });
          p.lines = viewLines(c, c.filters ?? [], ref, "after");
          break;
        case "removeView": {
          const v = shown.peek("saved_views", c.id);
          p.title = v?.name ? t("changes.title.view", { name: v.name }) : t("changes.title.viewSaved");
          if (v && !(v as { deleted?: boolean }).deleted) p.lines = viewLines(v, viewFilters(shown, c.id), ref, "before");
          break;
        }
        case "settings": {
          p.title = t("changes.title.settings");
          const cur = (shown.get("settings", "settings") ?? {}) as Record<string, unknown>;
          for (const [k, v] of Object.entries(c.set)) {
            const [label, names] = SETTING_LABEL[k]!();
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
        const hexLine: PlannedLine[] = hexAfter !== hexBefore ? [{ field: "icaoHex", label: t("changes.field.icaoHex"), before: hexBefore ?? "", after: hexAfter ?? "", private: false }] : [];
        p.lines = [...lines(AIRFRAME_SHOW, before, ctx(shown), rowOf("airframes", mergedInto ?? c.id), ctx(shown)), ...hexLine, { field: "provider", label: t("changes.field.source"), before: "", after: PROVIDER_LABEL[c.facts.provider] ?? c.facts.provider, private: false }];
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
