// Records as the reading commands show them: JSON with ids, codes and names resolved, and the labels the web app
// uses. Private fields only say whether they are recorded (docs/34, "Private fields").

import { checkAll, flightDay, resolveAirframes, type Finding, type Flight, type Sighting, type TableName } from "@touchdown/core";
import { dateTimeLabel, durShort, modelLabel, typeName, viewFlight, type FlightView } from "@touchdown/core/view";
import { privateFields, type OpenedLog } from "./read.ts";

export function airportJson(log: OpenedLog, id: string | null, raw: string | null) {
  const a = log.ref.airport(id);
  if (!a) return raw ? { raw } : null;
  return { id: a.id, iata: a.iata, icao: a.icao, name: a.name, city: a.city, country: a.country };
}

export function operatorJson(log: OpenedLog, id: string | null, raw: string | null) {
  const o = log.ref.operator(id);
  if (!o) return raw ? { raw } : null;
  return { id: o.id, iata: o.iata, icao: o.icao, name: o.name, own: !o.id.startsWith("op_") };
}

/** "08:00 Wed 2 Apr · UTC−4": a precise time always with its local date and offset. */
export const timeLabel = (dt: string | null | undefined): string | null => dateTimeLabel(dt) || null;

/** "Airbus A321neo", or the model in the user's naming when there is one. */
export const aircraftLabel = (log: OpenedLog, typeCode: string | null, model: string | null) => (model ? modelLabel(model, typeCode, log.ref, log.models) : typeName(typeCode, log.ref)) || "";

export function trackOf(log: OpenedLog, flightId: string): { provider: string | null; coverage: string } | null {
  const t = log.store.all("tracks").find((x) => x.flightId === flightId);
  return t ? { provider: t.provider, coverage: t.coverage ?? "complete" } : null;
}

export function flightJson(log: OpenedLog, v: FlightView) {
  const f = v.f;
  return {
    id: f.id,
    date: v.day,
    scheduledDate: f.scheduledDate,
    flightNumber: f.flightNumber,
    airline: operatorJson(log, f.airlineId, f.airlineRaw),
    operatedBy: f.operatingAirlineId ? operatorJson(log, f.operatingAirlineId, null) : null,
    from: airportJson(log, f.fromAirportId, f.fromRaw),
    to: airportJson(log, f.toAirportId, f.toRaw),
    divertedTo: f.divertedToAirportId ? airportJson(log, f.divertedToAirportId, null) : null,
    boarding: f.boardingAt,
    departureScheduled: f.departureScheduledAt,
    departure: f.departureAt,
    takeoff: f.takeoffAt,
    landing: f.landingAt,
    arrivalScheduled: f.arrivalScheduledAt,
    arrival: f.arrivalAt,
    durationMin: v.min,
    distanceKm: v.km === null ? null : Math.round(v.km),
    registration: f.registration,
    typeCode: f.typeCode,
    type: typeName(f.typeCode, log.ref) || null,
    model: f.model,
    aircraftId: f.airframeId,
    seat: f.seat,
    seatPosition: f.seatPosition,
    cabinClass: f.cabinClass,
    bookingClass: f.bookingClass,
    fareBrand: f.fareBrand,
    reason: f.reason,
    departureTerminal: f.departureTerminal,
    departureGate: f.departureGate,
    arrivalTerminal: f.arrivalTerminal,
    arrivalGate: f.arrivalGate,
    livery: f.livery,
    specialLivery: f.specialLivery,
    notes: f.notes,
    track: trackOf(log, f.id),
    private: privateFields(f),
  };
}

export function sightingJson(log: OpenedLog, s: Sighting) {
  return {
    id: s.id,
    date: s.seenOn,
    time: s.seenAt,
    airport: airportJson(log, s.airportId, s.airportRaw),
    spot: s.spotName,
    registration: s.registration ?? s.registrationRaw,
    airline: operatorJson(log, s.operatorId, s.operatorRaw),
    typeCode: s.typeCode,
    type: typeName(s.typeCode, log.ref) || null,
    model: s.model,
    aircraftId: s.airframeId,
    phase: s.phase,
    livery: s.livery,
    specialLivery: s.specialLivery,
    tags: log.store
      .all("sighting_tags")
      .filter((t) => t.sightingId === s.id && t.tag)
      .map((t) => t.tag),
    photos: s.photoCount,
    notes: s.notes,
  };
}

export const flightView = (log: OpenedLog, f: Flight) => viewFlight(f, log.ref, log.codes);

export const duration = (min: number | null) => (min === null ? "" : durShort(min).replace(/ /g, " "));

/** The day of a flight, for rows: "2025-04-02". */
export const dayOf = (f: Flight) => flightDay(f) ?? f.scheduledDate ?? "";

// ---------- findings ----------

/**
 * Open findings (not accepted), as the Issues page lists them. Airframes are linked again first, in memory only,
 * so findings about one registration on two aircraft are found.
 */
export function openFindings(log: OpenedLog): Finding[] {
  const { overlaps } = resolveAirframes(log.store, log.ref);
  const acked = new Set(log.store.all("issue_acks").map((a) => `${a.ruleId}|${a.fingerprint}`));
  return checkAll(log.store, log.ref, { overlaps }).filter((f) => !acked.has(`${f.ruleId}|${f.fingerprint}`));
}

export const findingsOf = (all: Finding[], table: TableName, id: string) => all.filter((f) => f.records.some((r) => r.table === table && r.id === id));

export function findingJson(f: Finding) {
  return { id: f.fingerprint, rule: f.ruleId, severity: f.severity, message: f.message, records: f.records, fixes: f.fixes.map((x, i) => ({ n: i + 1, label: x.label })) };
}
