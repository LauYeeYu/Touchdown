// Field rules (V-) and cross-record rules (C-) from docs/20-validation.md. External rules (X-) need the
// lookup service and arrive in phase 4.

import { inSentence, locale, series, t, tDynamic } from "@touchdown/i18n";
import { airportName, looksLikeOperatorName, type RefIndex } from "../ref/index.ts";
import type { Airframe, Flight, Sighting, Track } from "../schema/tables.ts";
import type { Store } from "../store.ts";
import type { Finding, RecordRef, Severity, SuggestedFix } from "./types.ts";
import { fnv1a } from "../ids.ts";
import { arrivalAirportId, flightDay, flightDistanceKm, flightDurationMin, greatCircleKm, nextLegOf } from "../derive.ts";
import { normaliseRegistration, registrationMatchForm } from "../normalise/registration.ts";
import { liveryAround } from "../livery.ts";
import { privateIndex, type FlightPrivateValues } from "../private.ts";
import { isSeatFormat, parseFlightNumber } from "../normalise/flight.ts";
import { addDays, daysBetween, formatOffset, instant, localDateOf, offsetAt, parseDateTime, todayIn, zonedDateTime } from "../time/index.ts";
import { trackRouteProblem, trackTimeProblem } from "../tracks.ts";

export const FIRST_POWERED_FLIGHT = "1903-12-17";

const regionNames = new Map<string, Intl.DisplayNames>();
function countryLabel(code: string): string {
  try {
    let names = regionNames.get(locale());
    if (!names) regionNames.set(locale(), (names = new Intl.DisplayNames([locale()], { type: "region" })));
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "A and B", "A and B and C". */
const andList = (items: string[]) => (items.length ? items.reduce((first, second) => t("core.list.and", { first, second })) : "");
/** "A or B". */
const orList = (items: string[]) => (items.length ? items.reduce((first, second) => t("core.list.or", { first, second })) : "");
/** Spellings of one value, each in quotes: "AAl" and "AAL". */
const quotedList = (items: string[]) => andList(items.map((text) => t("core.quoted", { text })));

/** The words for a missing field in V-INCOMPLETE. */
function missingLabel(field: string): string {
  switch (field) {
    case "date":
      return t("rules.missing.date");
    case "departure airport":
      return t("rules.missing.departureAirport");
    case "arrival airport":
      return t("rules.missing.arrivalAirport");
    case "location":
      return t("rules.missing.location");
    default:
      return t("rules.missing.registration");
  }
}

export interface CheckOptions {
  today?: string; // YYYY-MM-DD; defaults to the runtime's local date
  overlaps?: { table: "flights" | "sightings"; id: string; registration: string; airframeIds: string[] }[];
}

class Collector {
  readonly findings: Finding[] = [];
  add(
    ruleId: string,
    severity: Severity,
    records: RecordRef[],
    fields: string[],
    message: string,
    keyValues: unknown[],
    fixes: SuggestedFix[] = [],
  ) {
    const fingerprint = fnv1a(JSON.stringify([ruleId, records.map((r) => `${r.table}:${r.id}`).sort(), keyValues]));
    this.findings.push({ ruleId, severity, records, fields, message, fixes, fingerprint });
  }
}

const F = (id: string): RecordRef => ({ table: "flights", id });
const S = (id: string): RecordRef => ({ table: "sightings", id });

const FLIGHT_TIME_FIELDS = ["boardingAt", "departureAt", "takeoffAt", "landingAt", "arrivalAt"] as const;


function flightLabel(f: Flight): string {
  const date = f.scheduledDate ?? flightDay(f);
  if (f.flightNumber && date) return t("rules.label.flight", { flightNumber: f.flightNumber, date });
  return f.flightNumber || date || t("rules.label.thisFlight");
}

/**
 * An airport code as typed with no airport linked. A code known now was saved before its airport was (a small
 * airfield, or one the user added since): the fix links every record with it.
 */
function checkAirportCode(out: Collector, r: RecordRef, field: string, raw: string | null, linked: boolean, ref: RefIndex, label: string) {
  if (!raw || linked) return;
  const known = ref.airportByCode(raw);
  if (!known) {
    out.add("V-AIRPORT-KNOWN", "error", [r], [field], t("rules.airportKnown", { label, code: raw }), [raw]);
    return;
  }
  const value = t("format.nameWithCode", { name: airportName(known), code: known.icao ?? known.iata ?? raw });
  out.add("V-AIRPORT-KNOWN", "error", [r], [field], t("rules.airportNotLinked", { label, code: raw }), [raw], [{ ...r, field, value: known.id, airportCode: raw, label: t("rules.fix.use", { value }) }]);
}

/** For a company's name in the airline field ("Hyundai"): add it as the user's own operator. */
function namedOperatorFix(r: RecordRef, field: string, raw: string): SuggestedFix[] {
  if (!looksLikeOperatorName(raw)) return [];
  const name = raw.trim();
  return [{ table: r.table, id: r.id, field, value: null, operatorName: name, label: t("rules.fix.addOperator", { name }) }];
}

function sightingLabel(s: Sighting): string {
  if (s.registration && s.seenOn) return t("rules.label.sighting", { registration: s.registration, date: s.seenOn });
  return s.registration || s.seenOn || t("rules.label.thisSighting");
}

export function checkAll(store: Store, ref: RefIndex, opts: CheckOptions = {}): Finding[] {
  const out = new Collector();
  const today = opts.today ?? todayIn();
  const flights = store.all("flights");
  const sightings = store.all("sightings");
  const airframes = new Map(store.all("airframes").map((a) => [a.id, a]));
  const tracks = new Map(store.all("tracks").map((t) => [t.flightId, t]));

  for (const f of flights) checkFlight(out, f, ref, today, airframes, tracks.get(f.id) ?? null);
  for (const s of sightings) checkSighting(out, s, ref, today, airframes);
  checkCross(out, flights, sightings, airframes, ref, opts, privateIndex(store));
  return out.findings;
}

// ---------- shared field checks ----------

function checkAircraftFields(
  out: Collector,
  r: RecordRef,
  rec: Flight | Sighting,
  ref: RefIndex,
  operatorCountry: string | null,
  label: string,
) {
  if (rec.registration) {
    const n = normaliseRegistration(rec.registration, ref);
    if (n && !n.knownFormat) {
      out.add("V-REG-FORMAT", "warning", [r], ["registration"], t("rules.regFormat", { registration: rec.registration }), [rec.registration]);
    }
    if (n?.country && operatorCountry && n.country !== operatorCountry) {
      out.add("V-REG-COUNTRY", "info", [r], ["registration"], t("rules.regCountry", { registration: rec.registration, country: countryLabel(n.country), airlineCountry: countryLabel(operatorCountry) }), [rec.registration, operatorCountry]);
    }
  }
  if (rec.typeCode && !ref.type(rec.typeCode)) {
    const fromModel = rec.model ? ref.typesForModel(rec.model) : [];
    const fixes: SuggestedFix[] = fromModel.length === 1 ? [{ ...r, field: "typeCode", value: fromModel[0]!, label: t("rules.fix.setTypeCode", { typeCode: fromModel[0]! }) }] : [];
    out.add("V-TYPE-KNOWN", "error", [r], ["typeCode"], t("rules.typeKnown", { typeCode: rec.typeCode }), [rec.typeCode], fixes);
  }
  if (rec.modelRaw && !rec.model) {
    out.add("V-MODEL-PARSE", "warning", [r], ["model"], t("rules.modelParse", { model: rec.modelRaw }), [rec.modelRaw]);
  }
  if (rec.model && rec.typeCode && ref.type(rec.typeCode) && ref.modelMatchesType(rec.model, rec.typeCode) === false) {
    const types = ref.typesForModel(rec.model);
    const fixes: SuggestedFix[] = types.length === 1 ? [{ ...r, field: "typeCode", value: types[0]!, label: t("rules.fix.setTypeCode", { typeCode: types[0]! }) }] : [];
    const values = { label, model: rec.model, typeCode: rec.typeCode };
    const message = types.length ? t("rules.modelTypeFits", { ...values, types: orList(types) }) : t("rules.modelType", values);
    out.add("V-MODEL-TYPE", "warning", [r], ["model", "typeCode"], message, [rec.model, rec.typeCode], fixes);
  }
  if (rec.notes && /\b\d{13}\b/.test(rec.notes)) {
    out.add("V-PRIVATE-IN-NOTES", "info", [r], ["notes"], t("rules.privateInNotes"), [fnv1a(rec.notes)]);
  }
}

function checkDate(out: Collector, r: RecordRef, field: string, date: string | null, today: string, label: string) {
  if (!date) return;
  if (date < FIRST_POWERED_FLIGHT) out.add("V-DATE-SANE", "error", [r], [field], t("rules.dateBeforeFlight", { label, date }), [date]);
  else if (date > today) out.add("V-DATE-SANE", "error", [r], [field], t("rules.dateFuture", { label, date }), [date]);
}

function checkFirstFlight(out: Collector, r: RecordRef, date: string | null, airframes: Map<string, Airframe>, airframeId: string | null, label: string) {
  const a = airframeId ? airframes.get(airframeId) : undefined;
  if (date && a?.firstFlightDate && date < a.firstFlightDate) {
    out.add("V-BEFORE-FIRST-FLIGHT", "error", [r], ["registration"], t("rules.beforeFirstFlight", { label, date: a.firstFlightDate }), [date, a.firstFlightDate]);
  }
}

// ---------- flights ----------

function checkFlight(out: Collector, f: Flight, ref: RefIndex, today: string, airframes: Map<string, Airframe>, track: Track | null) {
  const r = F(f.id);
  const label = flightLabel(f);
  const day = flightDay(f);
  checkDate(out, r, "scheduledDate", f.scheduledDate ?? day, today, label);

  const from = ref.airport(f.fromAirportId);
  const to = ref.airport(f.toAirportId);
  checkAirportCode(out, r, "fromAirportId", f.fromRaw, !!from, ref, label);
  checkAirportCode(out, r, "toAirportId", f.toRaw, !!to, ref, label);
  if (from && to && from.id === to.id && !f.divertedToAirportId) {
    out.add("V-AIRPORT-SAME", "warning", [r], ["fromAirportId", "toAirportId"], t("rules.airportSame", { label, airport: from.iata ?? from.icao ?? "" }), [from.id]);
  }

  const airline = ref.operator(f.airlineId);
  if (f.airlineRaw && !airline) out.add("V-OPERATOR-KNOWN", "error", [r], ["airlineId"], t("rules.operatorKnown", { label, code: f.airlineRaw }), [f.airlineRaw], namedOperatorFix(F(f.id), "airlineId", f.airlineRaw));

  if (f.flightNumber) {
    const p = parseFlightNumber(f.flightNumber);
    if (!p) out.add("V-FLIGHTNO-FORMAT", "warning", [r], ["flightNumber"], t("rules.flightNumberFormat", { flightNumber: f.flightNumber }), [f.flightNumber]);
    else if (airline && p.designator !== airline.iata && p.designator !== airline.icao) {
      out.add("V-FLIGHTNO-AIRLINE", "warning", [r], ["flightNumber", "airlineId"], t("rules.flightNumberAirline", { flightNumber: f.flightNumber, airline: airline.name, codes: [airline.iata, airline.icao].filter(Boolean).join(" / ") }), [f.flightNumber, airline.id]);
    }
  }
  if (f.seat && !isSeatFormat(f.seat)) out.add("V-SEAT-FORMAT", "warning", [r], ["seat"], t("rules.seatFormat", { label, seat: f.seat }), [f.seat]);

  // The airline that flew it, when another than the one that sold it, is the one whose country the registration is compared with.
  checkAircraftFields(out, r, f, ref, (ref.operator(f.operatingAirlineId) ?? airline)?.country ?? null, label);
  checkFirstFlight(out, r, day, airframes, f.airframeId, label);

  // Times.
  // A diverted flight lands, and arrives, at the airport it was diverted to.
  const landed = ref.airport(arrivalAirportId(f)) ?? to;
  const seq = FLIGHT_TIME_FIELDS.map((k) => [k, instant(f[k])] as const).filter(([, t]) => t !== null) as [string, number][];
  for (let i = 1; i < seq.length; i++) {
    const [ka, ta] = seq[i - 1]!;
    const [kb, tb] = seq[i]!;
    const strict = ka === "takeoffAt" && kb === "landingAt";
    if (tb < ta || (strict && tb === ta)) {
      out.add("V-TIMES-ORDER", "error", [r], [ka, kb], t("rules.timesOrder", { label, later: tDynamic(`rules.time.${kb.replace("At", "")}`), earlier: tDynamic(`rules.time.${ka.replace("At", "")}`) }), [f[ka as keyof Flight], f[kb as keyof Flight]], afterMidnightFix(f, r, ka, kb, from?.tz, landed?.tz));
    }
  }
  const zones: [string, string | null | undefined][] = [
    ["boardingAt", from?.tz],
    ["departureScheduledAt", from?.tz],
    ["departureAt", from?.tz],
    ["takeoffAt", from?.tz],
    ["landingAt", landed?.tz],
    ["arrivalScheduledAt", to?.tz],
    ["arrivalAt", landed?.tz],
  ];
  for (const [field, tz] of zones) {
    const v = f[field as keyof Flight] as string | null;
    if (!v || !tz) continue;
    const p = parseDateTime(v);
    if (!p) continue;
    const expected = offsetAt(tz, p.epochMs);
    if (expected !== p.offsetMin) {
      // Keep the wall-clock time; the offset was wrong.
      const fixed = zonedDateTime(p.date, p.time, tz)!;
      out.add("V-TIME-OFFSET", "error", [r], [field], t("rules.timeOffset", { label, value: v, offset: formatOffset(p.offsetMin), tz, expected: formatOffset(expected) }), [v, tz], [{ ...r, field, value: fixed, label: t("rules.fix.use", { value: fixed }) }]);
    }
  }
  if (f.scheduledDate && f.takeoffAt) {
    const takeoffDay = localDateOf(f.takeoffAt)!;
    const diff = daysBetween(f.scheduledDate, takeoffDay);
    if (diff === 1) {
      out.add("V-DAY-ROLLOVER", "info", [r], ["takeoffAt"], t("rules.dayRollover", { label, date: takeoffDay }), [f.scheduledDate, f.takeoffAt]);
    } else if (diff !== 0) {
      out.add("V-DAY-ROLLOVER", "error", [r], ["takeoffAt"], t("rules.dayRolloverDays", { label, date: takeoffDay, days: diff }), [f.scheduledDate, f.takeoffAt]);
    } else {
      const clock = parseDateTime(f.takeoffAt)!.time;
      const evidence = f.boardingAt || f.departureScheduledAt || f.departureAt;
      if (clock < "04:00" && !evidence) {
        out.add("V-DAY-ROLLOVER", "warning", [r], ["takeoffAt"], t("rules.dayRolloverEarly", { label, clock: clock.slice(0, 5), date: addDays(f.scheduledDate, 1) }), [f.takeoffAt]);
      }
    }
  }
  // The flight's date is the day it was scheduled to leave, so the timetable's departure falls on it.
  if (f.scheduledDate && f.departureScheduledAt) {
    const scheduledDay = localDateOf(f.departureScheduledAt);
    const diff = scheduledDay ? daysBetween(f.scheduledDate, scheduledDay) : 0;
    if (diff !== 0) {
      out.add("V-SCHEDULE-DATE", Math.abs(diff) === 1 ? "warning" : "error", [r], ["scheduledDate", "departureScheduledAt"], t("rules.scheduleDate", { label, day: scheduledDay ?? "", date: f.scheduledDate }), [f.scheduledDate, f.departureScheduledAt]);
    }
  }
  // A track is checked against its flight when it is added: these find one the flight has since moved away from.
  if (track) {
    const first = instant(track.firstPointAt);
    const last = instant(track.lastPointAt);
    const late = first !== null && last !== null ? trackTimeProblem(first / 1000, last / 1000, f) : null;
    if (late) out.add("V-TRACK-TIMES", "error", [r], ["takeoffAt", "landingAt"], t("rules.trackTimes", { label, problem: inSentence(late) }), [f.scheduledDate, f.takeoffAt, f.landingAt, track.id]);
    const away = trackRouteProblem(track, f, ref);
    if (away) out.add("V-TRACK-ROUTE", "warning", [r], ["fromAirportId", "toAirportId"], t("rules.trackRoute", { label, problem: inSentence(away) }), [f.fromAirportId, arrivalAirportId(f), track.id]);
  }
  const km = flightDistanceKm(f, ref);
  const min = flightDurationMin(f);
  if (km && min) {
    const kmh = km / (min / 60);
    if (kmh < 150 || kmh > 1100) {
      out.add("V-DURATION-SPEED", "warning", [r], ["takeoffAt", "landingAt"], t("rules.speed", { label, km: Math.round(km), hours: Math.floor(min / 60), minutes: min % 60, kmh: Math.round(kmh) }), [Math.round(km), min]);
    }
  }
  if (f.distanceKmOverride) {
    const gc = greatCircleKm(f, ref);
    if (gc && Math.abs(f.distanceKmOverride - gc) / gc > 0.03) {
      out.add("V-DISTANCE-DIFF", "info", [r], ["distanceKmOverride"], t("rules.distance", { label, entered: Math.round(f.distanceKmOverride), greatCircle: Math.round(gc) }), [f.distanceKmOverride], [{ ...r, field: "distanceKmOverride", value: null, label: t("rules.fix.greatCircle") }]);
    }
  }
  const missing = [
    !day && "date",
    !f.fromAirportId && "departure airport",
    !f.toAirportId && "arrival airport",
    !f.registration && "registration",
  ].filter(Boolean) as string[];
  if (missing.length) out.add("V-INCOMPLETE", "info", [r], [], t("rules.incomplete", { label, fields: series(missing.map(missingLabel)) }), missing);
}

/**
 * Boarding before midnight and a takeoff clock time just after it, both on the scheduled date: the takeoff
 * (and landing) were on the next day. Offer to move them.
 */
function afterMidnightFix(f: Flight, r: RecordRef, ka: string, kb: string, fromTz: string | null | undefined, toTz: string | null | undefined): SuggestedFix[] {
  if (kb !== "takeoffAt" || !["boardingAt", "departureAt"].includes(ka) || !f.takeoffAt) return [];
  const before = instant(f[ka as keyof Flight] as string)!;
  const p = parseDateTime(f.takeoffAt)!;
  // The same clock time a day later, with the offset in force then: the clocks may change overnight.
  const shift = (v: string, tz: string | null | undefined) => {
    const q = parseDateTime(v)!;
    const date = addDays(q.date, 1);
    return (tz && zonedDateTime(date, q.time, tz)) || `${date}${v.slice(10)}`;
  };
  const takeoff = shift(f.takeoffAt, fromTz);
  const next = instant(takeoff)!;
  if (next <= before || next - before > 4 * 3_600_000) return [];
  const also: SuggestedFix["also"] = f.landingAt ? [{ field: "landingAt", value: shift(f.landingAt, toTz) }] : [];
  return [{ ...r, field: "takeoffAt", value: takeoff, also, label: t("rules.fix.moveTakeoff", { landing: f.landingAt ? "yes" : "no", date: addDays(p.date, 1) }) }];
}

// ---------- sightings ----------

function checkSighting(out: Collector, s: Sighting, ref: RefIndex, today: string, airframes: Map<string, Airframe>) {
  const r = S(s.id);
  const label = sightingLabel(s);
  checkDate(out, r, "seenOn", s.seenOn, today, label);
  if (s.seenAt && s.seenOn && localDateOf(s.seenAt) !== s.seenOn) {
    out.add("V-TIMES-ORDER", "error", [r], ["seenAt"], t("rules.seenAt", { label, time: s.seenAt, date: s.seenOn }), [s.seenAt, s.seenOn]);
  }
  checkAirportCode(out, r, "airportId", s.airportRaw, !!ref.airport(s.airportId), ref, label);
  const op = ref.operator(s.operatorId);
  if (s.operatorRaw && !op) out.add("V-OPERATOR-KNOWN", "error", [r], ["operatorId"], t("rules.operatorKnown", { label, code: s.operatorRaw }), [s.operatorRaw], namedOperatorFix(r, "operatorId", s.operatorRaw));
  checkAircraftFields(out, r, s, ref, op && op.kind !== "private" ? op.country : null, label);
  checkFirstFlight(out, r, s.seenOn, airframes, s.airframeId, label);
  const missing = [!s.seenOn && "date", !s.airportId && "location", !s.registration && "registration"].filter(Boolean) as string[];
  if (missing.length) out.add("V-INCOMPLETE", "info", [r], [], t("rules.incomplete", { label, fields: series(missing.map(missingLabel)) }), missing);
}

// ---------- cross-record ----------

function groupBy<T>(items: T[], key: (t: T) => string | null): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    if (k === null) continue;
    m.set(k, [...(m.get(k) ?? []), it]);
  }
  return m;
}

function checkCross(
  out: Collector,
  flights: Flight[],
  sightings: Sighting[],
  airframes: Map<string, Airframe>,
  ref: RefIndex,
  opts: CheckOptions,
  // Ticket numbers, from the flights' private rows (docs/32, "Private data").
  tickets: Map<string, FlightPrivateValues>,
) {
  // C-TYPE-MISMATCH: record type differs from its airframe's type.
  const recs: { r: RecordRef; rec: Flight | Sighting }[] = [
    ...flights.map((rec) => ({ r: F(rec.id), rec })),
    ...sightings.map((rec) => ({ r: S(rec.id), rec })),
  ];
  for (const [airframeId, list] of groupBy(recs, (x) => x.rec.airframeId)) {
    const a = airframes.get(airframeId);
    if (!a?.typeCode) continue;
    const odd = list.filter((x) => x.rec.typeCode && x.rec.typeCode !== a.typeCode);
    if (!odd.length) continue;
    const regs = [...new Set(list.map((x) => x.rec.registration).filter(Boolean))].join(" / ");
    const same = list.length - odd.length;
    const agreeing = list.filter((x) => x.rec.typeCode === a.typeCode);
    for (const x of odd) {
      const reverse: SuggestedFix[] =
        agreeing.length === 1 && x.rec.typeCode
          ? [{ ...agreeing[0]!.r, field: "typeCode", value: x.rec.typeCode, label: t("rules.fix.setOtherRecord", { typeCode: x.rec.typeCode }) }]
          : [];
      const values = { registrations: regs, typeCode: x.rec.typeCode ?? "", aircraftType: a.typeCode };
      out.add(
        "C-TYPE-MISMATCH",
        "error",
        [x.r],
        ["typeCode"],
        a.provisional ? t("rules.typeMismatchRecords", { ...values, count: same }) : t("rules.typeMismatch", values),
        [x.rec.typeCode, a.typeCode],
        [{ ...x.r, field: "typeCode", value: a.typeCode, label: t("rules.fix.setThisRecord", { typeCode: a.typeCode }) }, ...reverse],
      );
    }
  }

  for (const o of opts.overlaps ?? []) {
    const r = o.table === "flights" ? F(o.id) : S(o.id);
    out.add("C-REG-OVERLAP", "error", [r], ["registration"], t("rules.regOverlap", { registration: o.registration, count: o.airframeIds.length }), [o.registration, o.airframeIds]);
  }

  // C-DUP-FLIGHT: same date + flight number + from.
  for (const [, list] of groupBy(flights, (f) => (f.flightNumber && f.fromAirportId ? `${f.scheduledDate ?? flightDay(f)}|${f.flightNumber}|${f.fromAirportId}` : null))) {
    if (list.length > 1) {
      out.add("C-DUP-FLIGHT", "warning", list.map((f) => F(f.id)), ["flightNumber"], t("rules.dupFlight", { label: flightLabel(list[0]!), count: list.length }), []);
    }
  }
  // C-DUP-SIGHTING: same date + registration + location.
  for (const [, list] of groupBy(sightings, (s) => (s.registration && s.seenOn ? `${s.seenOn}|${s.registration}|${s.airportId ?? s.airportRaw ?? ""}` : null))) {
    if (list.length > 1) {
      out.add("C-DUP-SIGHTING", "info", list.map((s) => S(s.id)), ["registration"], t("rules.dupSighting", { label: sightingLabel(list[0]!), count: list.length }), []);
    }
  }
  // C-DUP-TICKET: same ticket number and coupon. The number itself is private and never shown. The legs of one flight
  // number in a row (a stop, or a change of aircraft) are one segment, so they share a coupon.
  for (const [, list] of groupBy(flights, (f) => tickets.get(f.id)?.ticketNumber?.replace(/\s+/g, "") || null)) {
    const segments = list.filter((f) => !list.some((g) => g !== f && nextLegOf(g, f))).length;
    if (segments > 1) {
      out.add("C-DUP-TICKET", "warning", list.map((f) => F(f.id)), ["ticketNumber"], t("rules.dupTicket", { flights: andList(list.map(flightLabel)) }), []);
    }
  }
  // C-FLIGHT-OVERLAP: two flights in the air at the same time.
  const timed = flights
    .map((f) => ({ f, a: instant(f.takeoffAt), b: instant(f.landingAt) }))
    .filter((x): x is { f: Flight; a: number; b: number } => x.a !== null && x.b !== null && x.b > x.a)
    .sort((x, y) => x.a - y.a);
  for (let i = 1; i < timed.length; i++) {
    const p = timed[i - 1]!;
    const q = timed[i]!;
    if (q.a < p.b) {
      out.add("C-FLIGHT-OVERLAP", "error", [F(p.f.id), F(q.f.id)], ["takeoffAt", "landingAt"], t("rules.flightOverlap", { first: flightLabel(p.f), second: flightLabel(q.f) }), [p.f.takeoffAt, q.f.takeoffAt]);
    }
  }
  // C-CODE-VARIANTS: raw airline and airport codes that differ only by case or spaces (AAl and AAL). Type
  // codes are always stored upper case, so their spelling never splits a count.
  const codeFields: [string, (Flight | Sighting)[], (x: Flight & Sighting) => string | null, "flights" | "sightings"][] = [
    ["airlineRaw", flights, (x) => x.airlineRaw, "flights"],
    ["fromRaw", flights, (x) => x.fromRaw, "flights"],
    ["toRaw", flights, (x) => x.toRaw, "flights"],
    ["operatorRaw", sightings, (x) => x.operatorRaw, "sightings"],
    ["airportRaw", sightings, (x) => x.airportRaw, "sightings"],
  ];
  for (const [field, list, get] of codeFields) {
    const byNorm = groupBy(list, (x) => get(x as Flight & Sighting)?.trim().toUpperCase() || null);
    for (const [norm, group] of byNorm) {
      const spellings = [...new Set(group.map((x) => get(x as Flight & Sighting)!))];
      if (spellings.length < 2) continue;
      const odd = group.filter((x) => get(x as Flight & Sighting) !== norm);
      out.add(
        "C-CODE-VARIANTS",
        "warning",
        odd.map((x) => ("seenOn" in x ? S(x.id) : F(x.id))),
        [field],
        t("rules.codeVariants", { spellings: quotedList(spellings), code: norm }),
        [field, spellings.sort()],
      );
    }
  }
  // C-LIVERY-NAME: same airframe, special livery spelt differently.
  for (const [, list] of groupBy(recs, (x) => (x.rec.airframeId && x.rec.specialLivery ? x.rec.airframeId : null))) {
    for (const [, same] of groupBy(list, (x) => x.rec.specialLivery!.toLowerCase().replace(/\s+/g, " ").trim())) {
      const spellings = [...new Set(same.map((x) => x.rec.specialLivery!))];
      if (spellings.length > 1) {
        out.add("C-LIVERY-NAME", "info", same.map((x) => x.r), ["specialLivery"], t("rules.liveryName", { spellings: quotedList(spellings) }), [spellings.sort()]);
      }
    }
  }
  // C-LIVERY-MISSING: no special livery on a day the aircraft's other records show it wore one.
  const aircraftKey = (rec: Flight | Sighting) => rec.airframeId ?? (rec.registration ? `reg:${registrationMatchForm(rec.registration)}` : null);
  for (const [, list] of groupBy(recs, (x) => aircraftKey(x.rec))) {
    if (!list.some((x) => x.rec.specialLivery)) continue;
    const dated = list.map((x) => ({ ...x, date: "seenOn" in x.rec ? x.rec.seenOn : flightDay(x.rec), specialLivery: x.rec.specialLivery }));
    for (const x of dated) {
      if (x.specialLivery || !x.date) continue;
      const worn = liveryAround(dated, x.date);
      if (!worn) continue;
      out.add(
        "C-LIVERY-MISSING",
        "warning",
        [x.r],
        ["specialLivery"],
        t("rules.liveryMissing", { aircraft: x.rec.registration ?? t("rules.label.theAircraft"), livery: worn.name, date: worn.on, table: x.r.table }),
        [worn.name],
        [{ ...x.r, field: "specialLivery", value: worn.name, label: t("rules.fix.setSpecialLivery", { livery: worn.name }) }],
      );
    }
  }
  // C-SAME-DAY: photographed an aircraft at an airport on a day the user flew it through there.
  const flownThrough = new Map<string, Flight>();
  for (const f of flights) {
    if (!f.airframeId) continue;
    const day = flightDay(f);
    for (const ap of [f.fromAirportId, f.toAirportId]) if (ap && day) flownThrough.set(`${f.airframeId}|${ap}|${day}`, f);
    const landingDay = localDateOf(f.landingAt);
    if (landingDay && f.toAirportId) flownThrough.set(`${f.airframeId}|${f.toAirportId}|${landingDay}`, f);
  }
  for (const s of sightings) {
    if (!s.airframeId || !s.airportId || !s.seenOn) continue;
    const f = flownThrough.get(`${s.airframeId}|${s.airportId}|${s.seenOn}`);
    if (f) {
      out.add("C-SAME-DAY", "info", [S(s.id), F(f.id)], [], t("rules.sameDay", { registration: s.registration ?? "", flight: flightLabel(f) }), []);
    }
  }
}
