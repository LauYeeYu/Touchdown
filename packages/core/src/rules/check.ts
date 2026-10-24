// Field rules (V-) and cross-record rules (C-) from docs/20-validation.md. External rules (X-) need the
// lookup service and arrive in phase 4.

import { looksLikeOperatorName, type RefIndex } from "../ref/index.ts";
import type { Airframe, Flight, Sighting } from "../schema/tables.ts";
import type { Store } from "../store.ts";
import type { Finding, RecordRef, Severity, SuggestedFix } from "./types.ts";
import { fnv1a } from "../ids.ts";
import { arrivalAirportId, flightDay, flightDistanceKm, flightDurationMin, greatCircleKm } from "../derive.ts";
import { normaliseRegistration, registrationMatchForm } from "../normalise/registration.ts";
import { liveryAround } from "../livery.ts";
import { isSeatFormat, parseFlightNumber } from "../normalise/flight.ts";
import { addDays, daysBetween, formatOffset, instant, localDateOf, offsetAt, parseDateTime, todayIn, zonedDateTime } from "../time/index.ts";

export const FIRST_POWERED_FLIGHT = "1903-12-17";

let regionNames: Intl.DisplayNames | null = null;
function countryLabel(code: string): string {
  try {
    regionNames ??= new Intl.DisplayNames(["en-GB"], { type: "region" });
    return regionNames.of(code) ?? code;
  } catch {
    return code;
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
  return [f.flightNumber, f.scheduledDate ?? flightDay(f)].filter(Boolean).join(" on ") || "This flight";
}

/** For a company's name in the airline field ("Hyundai"): add it as the user's own operator. */
function namedOperatorFix(r: RecordRef, field: string, raw: string): SuggestedFix[] {
  if (!looksLikeOperatorName(raw)) return [];
  const name = raw.trim();
  return [{ table: r.table, id: r.id, field, value: null, operatorName: name, label: `Add ${name} as your own operator` }];
}

function sightingLabel(s: Sighting): string {
  return [s.registration, s.seenOn].filter(Boolean).join(" on ") || "This sighting";
}

export function checkAll(store: Store, ref: RefIndex, opts: CheckOptions = {}): Finding[] {
  const out = new Collector();
  const today = opts.today ?? todayIn();
  const flights = store.all("flights");
  const sightings = store.all("sightings");
  const airframes = new Map(store.all("airframes").map((a) => [a.id, a]));

  for (const f of flights) checkFlight(out, f, ref, today, airframes);
  for (const s of sightings) checkSighting(out, s, ref, today, airframes);
  checkCross(out, flights, sightings, airframes, ref, opts);
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
      out.add("V-REG-FORMAT", "warning", [r], ["registration"], `${rec.registration} does not match any known national registration format.`, [rec.registration]);
    }
    if (n?.country && operatorCountry && n.country !== operatorCountry) {
      out.add("V-REG-COUNTRY", "info", [r], ["registration"], `${rec.registration} is registered in ${countryLabel(n.country)}; the airline is from ${countryLabel(operatorCountry)}. Common with leased aircraft.`, [rec.registration, operatorCountry]);
    }
  }
  if (rec.typeCode && !ref.type(rec.typeCode)) {
    const fromModel = rec.model ? ref.typesForModel(rec.model) : [];
    const fixes: SuggestedFix[] = fromModel.length === 1 ? [{ ...r, field: "typeCode", value: fromModel[0]!, label: `Set type code to ${fromModel[0]}` }] : [];
    out.add("V-TYPE-KNOWN", "error", [r], ["typeCode"], `${rec.typeCode} is not an ICAO type designator.`, [rec.typeCode], fixes);
  }
  if (rec.modelRaw && !rec.model) {
    out.add("V-MODEL-PARSE", "warning", [r], ["model"], `The model "${rec.modelRaw}" could not be read.`, [rec.modelRaw]);
  }
  if (rec.model && rec.typeCode && ref.type(rec.typeCode) && ref.modelMatchesType(rec.model, rec.typeCode) === false) {
    const types = ref.typesForModel(rec.model);
    const fixes: SuggestedFix[] = types.length === 1 ? [{ ...r, field: "typeCode", value: types[0]!, label: `Set type code to ${types[0]}` }] : [];
    const hint = types.length ? ` The model fits ${types.join(" or ")}.` : "";
    out.add("V-MODEL-TYPE", "warning", [r], ["model", "typeCode"], `${label}: model ${rec.model} does not match type code ${rec.typeCode}.${hint}`, [rec.model, rec.typeCode], fixes);
  }
  if (rec.notes && /\b\d{13}\b/.test(rec.notes)) {
    out.add("V-PRIVATE-IN-NOTES", "info", [r], ["notes"], "The notes contain what looks like a ticket number. Move it to the private ticket field?", [fnv1a(rec.notes)]);
  }
}

function checkDate(out: Collector, r: RecordRef, field: string, date: string | null, today: string, label: string) {
  if (!date) return;
  if (date < FIRST_POWERED_FLIGHT) out.add("V-DATE-SANE", "error", [r], [field], `${label}: ${date} is before the first powered flight.`, [date]);
  else if (date > today) out.add("V-DATE-SANE", "error", [r], [field], `${label}: ${date} is in the future. Only flown flights and past sightings are logged.`, [date]);
}

function checkFirstFlight(out: Collector, r: RecordRef, date: string | null, airframes: Map<string, Airframe>, airframeId: string | null, label: string) {
  const a = airframeId ? airframes.get(airframeId) : undefined;
  if (date && a?.firstFlightDate && date < a.firstFlightDate) {
    out.add("V-BEFORE-FIRST-FLIGHT", "error", [r], ["registration"], `${label} is dated before the aircraft's first flight (${a.firstFlightDate}).`, [date, a.firstFlightDate]);
  }
}

// ---------- flights ----------

function checkFlight(out: Collector, f: Flight, ref: RefIndex, today: string, airframes: Map<string, Airframe>) {
  const r = F(f.id);
  const label = flightLabel(f);
  const day = flightDay(f);
  checkDate(out, r, "scheduledDate", f.scheduledDate ?? day, today, label);

  const from = ref.airport(f.fromAirportId);
  const to = ref.airport(f.toAirportId);
  if (f.fromRaw && !from) out.add("V-AIRPORT-KNOWN", "error", [r], ["fromAirportId"], `${label}: airport code ${f.fromRaw} is not known.`, [f.fromRaw]);
  if (f.toRaw && !to) out.add("V-AIRPORT-KNOWN", "error", [r], ["toAirportId"], `${label}: airport code ${f.toRaw} is not known.`, [f.toRaw]);
  if (from && to && from.id === to.id && !f.divertedToAirportId) {
    out.add("V-AIRPORT-SAME", "warning", [r], ["fromAirportId", "toAirportId"], `${label} departs from and arrives at ${from.iata ?? from.icao}.`, [from.id]);
  }

  const airline = ref.operator(f.airlineId);
  if (f.airlineRaw && !airline) out.add("V-OPERATOR-KNOWN", "error", [r], ["airlineId"], `${label}: airline code ${f.airlineRaw} is not known.`, [f.airlineRaw], namedOperatorFix(F(f.id), "airlineId", f.airlineRaw));

  if (f.flightNumber) {
    const p = parseFlightNumber(f.flightNumber);
    if (!p) out.add("V-FLIGHTNO-FORMAT", "warning", [r], ["flightNumber"], `${f.flightNumber} is not a flight number (airline code + 1–4 digits).`, [f.flightNumber]);
    else if (airline && p.designator !== airline.iata && p.designator !== airline.icao) {
      out.add("V-FLIGHTNO-AIRLINE", "warning", [r], ["flightNumber", "airlineId"], `${f.flightNumber} does not start with ${airline.name}'s code (${[airline.iata, airline.icao].filter(Boolean).join(" / ")}).`, [f.flightNumber, airline.id]);
    }
  }
  if (f.seat && !isSeatFormat(f.seat)) out.add("V-SEAT-FORMAT", "warning", [r], ["seat"], `${label}: seat ${f.seat} is not a row number and a letter.`, [f.seat]);

  checkAircraftFields(out, r, f, ref, airline?.country ?? null, label);
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
      out.add("V-TIMES-ORDER", "error", [r], [ka, kb], `${label}: ${kb.replace("At", "")} is before ${ka.replace("At", "")}.`, [f[ka as keyof Flight], f[kb as keyof Flight]], afterMidnightFix(f, r, ka, kb, from?.tz, landed?.tz));
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
      out.add("V-TIME-OFFSET", "error", [r], [field], `${label}: ${v} has offset ${formatOffset(p.offsetMin)}, but the airport's time zone (${tz}) was ${formatOffset(expected)} then.`, [v, tz], [{ ...r, field, value: fixed, label: `Use ${fixed}` }]);
    }
  }
  if (f.scheduledDate && f.takeoffAt) {
    const takeoffDay = localDateOf(f.takeoffAt)!;
    const diff = daysBetween(f.scheduledDate, takeoffDay);
    if (diff === 1) {
      out.add("V-DAY-ROLLOVER", "info", [r], ["takeoffAt"], `${label} took off after midnight, on ${takeoffDay}.`, [f.scheduledDate, f.takeoffAt]);
    } else if (diff !== 0) {
      out.add("V-DAY-ROLLOVER", "error", [r], ["takeoffAt"], `${label}: takeoff on ${takeoffDay} is ${diff} days from the scheduled date.`, [f.scheduledDate, f.takeoffAt]);
    } else {
      const clock = parseDateTime(f.takeoffAt)!.time;
      const evidence = f.boardingAt || f.departureScheduledAt || f.departureAt;
      if (clock < "04:00" && !evidence) {
        out.add("V-DAY-ROLLOVER", "warning", [r], ["takeoffAt"], `${label}: takeoff at ${clock.slice(0, 5)} on the scheduled date. If the flight left after midnight, it took off on ${addDays(f.scheduledDate, 1)}.`, [f.takeoffAt]);
      }
    }
  }
  const km = flightDistanceKm(f, ref);
  const min = flightDurationMin(f);
  if (km && min) {
    const kmh = km / (min / 60);
    if (kmh < 150 || kmh > 1100) {
      out.add("V-DURATION-SPEED", "warning", [r], ["takeoffAt", "landingAt"], `${label}: ${Math.round(km)} km in ${Math.floor(min / 60)}h ${min % 60}m is ${Math.round(kmh)} km/h on average. Check the airports, dates and times.`, [Math.round(km), min]);
    }
  }
  if (f.distanceKmOverride) {
    const gc = greatCircleKm(f, ref);
    if (gc && Math.abs(f.distanceKmOverride - gc) / gc > 0.03) {
      out.add("V-DISTANCE-DIFF", "info", [r], ["distanceKmOverride"], `${label}: the distance entered (${Math.round(f.distanceKmOverride)} km) differs from the great-circle distance (${Math.round(gc)} km).`, [f.distanceKmOverride], [{ ...r, field: "distanceKmOverride", value: null, label: "Use the great-circle distance" }]);
    }
  }
  const missing = [
    !day && "date",
    !f.fromAirportId && "departure airport",
    !f.toAirportId && "arrival airport",
    !f.registration && "registration",
  ].filter(Boolean) as string[];
  if (missing.length) out.add("V-INCOMPLETE", "info", [r], [], `${label}: no ${missing.join(", ")}.`, missing);
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
  return [{ ...r, field: "takeoffAt", value: takeoff, also, label: `Move takeoff${f.landingAt ? " and landing" : ""} to the next day (${addDays(p.date, 1)})` }];
}

// ---------- sightings ----------

function checkSighting(out: Collector, s: Sighting, ref: RefIndex, today: string, airframes: Map<string, Airframe>) {
  const r = S(s.id);
  const label = sightingLabel(s);
  checkDate(out, r, "seenOn", s.seenOn, today, label);
  if (s.seenAt && s.seenOn && localDateOf(s.seenAt) !== s.seenOn) {
    out.add("V-TIMES-ORDER", "error", [r], ["seenAt"], `${label}: the time ${s.seenAt} is not on ${s.seenOn}.`, [s.seenAt, s.seenOn]);
  }
  if (s.airportRaw && !ref.airport(s.airportId)) out.add("V-AIRPORT-KNOWN", "error", [r], ["airportId"], `${label}: airport code ${s.airportRaw} is not known.`, [s.airportRaw]);
  const op = ref.operator(s.operatorId);
  if (s.operatorRaw && !op) out.add("V-OPERATOR-KNOWN", "error", [r], ["operatorId"], `${label}: airline code ${s.operatorRaw} is not known.`, [s.operatorRaw], namedOperatorFix(r, "operatorId", s.operatorRaw));
  checkAircraftFields(out, r, s, ref, op && op.kind !== "private" ? op.country : null, label);
  checkFirstFlight(out, r, s.seenOn, airframes, s.airframeId, label);
  const missing = [!s.seenOn && "date", !s.airportId && "location", !s.registration && "registration"].filter(Boolean) as string[];
  if (missing.length) out.add("V-INCOMPLETE", "info", [r], [], `${label}: no ${missing.join(", ")}.`, missing);
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
          ? [{ ...agreeing[0]!.r, field: "typeCode", value: x.rec.typeCode, label: `Set the other record to ${x.rec.typeCode}` }]
          : [];
      const basis = a.provisional ? `${same} other record${same === 1 ? " of this aircraft says" : "s of this aircraft say"} ${a.typeCode}` : `the aircraft is a ${a.typeCode}`;
      out.add(
        "C-TYPE-MISMATCH",
        "error",
        [x.r],
        ["typeCode"],
        `${regs} is recorded as ${x.rec.typeCode} here, but ${basis}. A typo, or a different aircraft with the same registration?`,
        [x.rec.typeCode, a.typeCode],
        [{ ...x.r, field: "typeCode", value: a.typeCode, label: `Set this record to ${a.typeCode}` }, ...reverse],
      );
    }
  }

  for (const o of opts.overlaps ?? []) {
    const r = o.table === "flights" ? F(o.id) : S(o.id);
    out.add("C-REG-OVERLAP", "error", [r], ["registration"], `${o.registration} is held by ${o.airframeIds.length} aircraft on this date. Fix the registration periods or choose the aircraft.`, [o.registration, o.airframeIds]);
  }

  // C-DUP-FLIGHT: same date + flight number + from.
  for (const [, list] of groupBy(flights, (f) => (f.flightNumber && f.fromAirportId ? `${f.scheduledDate ?? flightDay(f)}|${f.flightNumber}|${f.fromAirportId}` : null))) {
    if (list.length > 1) {
      out.add("C-DUP-FLIGHT", "warning", list.map((f) => F(f.id)), ["flightNumber"], `${flightLabel(list[0]!)} is logged ${list.length} times.`, []);
    }
  }
  // C-DUP-SIGHTING: same date + registration + location.
  for (const [, list] of groupBy(sightings, (s) => (s.registration && s.seenOn ? `${s.seenOn}|${s.registration}|${s.airportId ?? s.airportRaw ?? ""}` : null))) {
    if (list.length > 1) {
      out.add("C-DUP-SIGHTING", "info", list.map((s) => S(s.id)), ["registration"], `${sightingLabel(list[0]!)} is logged ${list.length} times at the same place. One sighting per aircraft per place per day; keep both only if that is intended.`, []);
    }
  }
  // C-DUP-TICKET: same ticket number and coupon. The number itself is private and never shown.
  for (const [, list] of groupBy(flights, (f) => f.ticketNumber?.replace(/\s+/g, "") || null)) {
    if (list.length > 1) {
      out.add("C-DUP-TICKET", "warning", list.map((f) => F(f.id)), ["ticketNumber"], `${list.map(flightLabel).join(" and ")} have the same ticket number and coupon. One coupon is probably mistyped.`, []);
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
      out.add("C-FLIGHT-OVERLAP", "error", [F(p.f.id), F(q.f.id)], ["takeoffAt", "landingAt"], `${flightLabel(p.f)} and ${flightLabel(q.f)} overlap in time.`, [p.f.takeoffAt, q.f.takeoffAt]);
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
        `${spellings.map((s) => `"${s}"`).join(" and ")} are the same code. They are counted as one (${norm}).`,
        [field, spellings.sort()],
      );
    }
  }
  // C-LIVERY-NAME: same airframe, special livery spelt differently.
  for (const [, list] of groupBy(recs, (x) => (x.rec.airframeId && x.rec.specialLivery ? x.rec.airframeId : null))) {
    for (const [, same] of groupBy(list, (x) => x.rec.specialLivery!.toLowerCase().replace(/\s+/g, " ").trim())) {
      const spellings = [...new Set(same.map((x) => x.rec.specialLivery!))];
      if (spellings.length > 1) {
        out.add("C-LIVERY-NAME", "info", same.map((x) => x.r), ["specialLivery"], `The same livery is spelt ${spellings.map((s) => `"${s}"`).join(" and ")}.`, [spellings.sort()]);
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
      const what = x.r.table === "flights" ? "this flight" : "this sighting";
      out.add(
        "C-LIVERY-MISSING",
        "warning",
        [x.r],
        ["specialLivery"],
        `${x.rec.registration ?? "The aircraft"} was in ${worn.name} on ${worn.on}, but ${what} has no special livery.`,
        [worn.name],
        [{ ...x.r, field: "specialLivery", value: worn.name, label: `Set special livery to ${worn.name}` }],
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
      out.add("C-SAME-DAY", "info", [S(s.id), F(f.id)], [], `You photographed ${s.registration} on the day you flew on it (${flightLabel(f)}).`, []);
    }
  }
}
