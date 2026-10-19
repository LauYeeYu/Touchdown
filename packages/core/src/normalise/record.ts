// Normalised values from the raw values of a flight or sighting. Used on manual entry and on import.
// Only formatting fixes are automatic (case, dashes, spaces); the raw value is always kept.

import type { RefIndex } from "../ref/index.ts";
import type { FlightValues, SightingValues } from "../schema/tables.ts";
import { normaliseRegistration } from "./registration.ts";
import { parseModel } from "./model.ts";
import { normaliseFlightNumber, normaliseSeat } from "./flight.ts";

const clean = (s: string | null | undefined) => (s ?? "").trim() || null;

export interface AircraftRaw {
  registrationRaw?: string | null;
  typeCodeRaw?: string | null;
  modelRaw?: string | null;
}

export function normaliseAircraft(raw: AircraftRaw, ref: RefIndex) {
  const registrationRaw = clean(raw.registrationRaw);
  const typeCodeRaw = clean(raw.typeCodeRaw);
  const modelRaw = clean(raw.modelRaw);
  return {
    registrationRaw,
    registration: normaliseRegistration(registrationRaw, ref)?.display ?? null,
    typeCodeRaw,
    typeCode: typeCodeRaw ? typeCodeRaw.toUpperCase().replace(/\s+/g, "") : null,
    modelRaw,
    model: parseModel(modelRaw)?.standard ?? null,
  };
}

/** Fill the normalised flight fields from the raw ones. Date-times are built by the caller. */
export function normaliseFlight(v: Partial<FlightValues>, ref: RefIndex): Partial<FlightValues> {
  const date = v.scheduledDate ?? null;
  const airlineRaw = clean(v.airlineRaw);
  const fromRaw = clean(v.fromRaw);
  const toRaw = clean(v.toRaw);
  return {
    ...v,
    flightNumber: normaliseFlightNumber(v.flightNumber),
    airlineRaw,
    airlineId: v.airlineId ?? ref.operatorByCode(airlineRaw, date)?.id ?? null,
    fromRaw,
    fromAirportId: v.fromAirportId ?? ref.airportByCode(fromRaw)?.id ?? null,
    toRaw,
    toAirportId: v.toAirportId ?? ref.airportByCode(toRaw)?.id ?? null,
    seat: normaliseSeat(v.seat),
    specialLivery: clean(v.specialLivery),
    livery: clean(v.livery),
    notes: clean(v.notes),
    ...normaliseAircraft(v, ref),
  };
}

export function normaliseSighting(v: Partial<SightingValues>, ref: RefIndex): Partial<SightingValues> {
  const operatorRaw = clean(v.operatorRaw);
  const airportRaw = clean(v.airportRaw);
  return {
    ...v,
    operatorRaw,
    operatorId: v.operatorId ?? ref.operatorByCode(operatorRaw, v.seenOn)?.id ?? null,
    airportRaw,
    airportId: v.airportId ?? ref.airportByCode(airportRaw)?.id ?? null,
    specialLivery: clean(v.specialLivery),
    livery: clean(v.livery),
    notes: clean(v.notes),
    ...normaliseAircraft(v, ref),
  };
}
