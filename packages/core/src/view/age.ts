// Aircraft age (docs/24-statistics.md, "Aircraft age"): the time from an aircraft's first flight to the day the user
// flew on it, and to today. The log records no day an aircraft stopped flying, only its status, so for an aircraft
// retired or written off the time to today is the time since its first flight, not an age in service. The same in the
// web app (Statistics) and the CLI. Nothing here is stored.

import { t } from "@touchdown/i18n";
import { flightDay } from "../derive.ts";
import type { Airframe, Flight } from "../schema/tables.ts";
import { daysBetween } from "../time/index.ts";
import { oneDecimal } from "./format.ts";

export interface AgeWhenFlown {
  flightId: string;
  airframeId: string;
  /** The flight's day. */
  day: string;
  /** From the aircraft's first flight to the flight's day. */
  days: number;
}

export interface AgeNow {
  airframeId: string;
  firstFlightDate: string;
  /** From the first flight to today. For an aircraft retired or written off, not its age in service. */
  days: number;
  status: Airframe["status"];
  /** The registration it was flown under last, among the flights given. */
  registration: string | null;
  typeCode: string | null;
}

export interface AircraftAges {
  /** One per flight. */
  whenFlown: AgeWhenFlown[];
  /** One per aircraft. */
  now: AgeNow[];
  /** Flights not counted: no date, no aircraft, an aircraft whose first flight is not known, or dated before it. */
  leftOut: { noDate: number; noAircraft: number; noFirstFlight: number; beforeFirstFlight: number };
}

/** An aircraft no longer flying, by its status: the time since its first flight is not an age in service. */
export const outOfService = (status: Airframe["status"]) => status === "retired" || status === "written_off";

/** The time from each flown aircraft's first flight to each flight, and to `today` (YYYY-MM-DD). */
export function aircraftAges(flights: Flight[], airframes: ReadonlyMap<string, Airframe>, today: string): AircraftAges {
  const whenFlown: AgeWhenFlown[] = [];
  const last = new Map<string, { day: string; flight: Flight }>();
  const leftOut = { noDate: 0, noAircraft: 0, noFirstFlight: 0, beforeFirstFlight: 0 };
  for (const f of flights) {
    const day = flightDay(f);
    const a = f.airframeId ? airframes.get(f.airframeId) : undefined;
    if (!day) leftOut.noDate++;
    else if (!a) leftOut.noAircraft++;
    else if (!a.firstFlightDate) leftOut.noFirstFlight++;
    else if (day < a.firstFlightDate) leftOut.beforeFirstFlight++;
    else {
      whenFlown.push({ flightId: f.id, airframeId: a.id, day, days: daysBetween(a.firstFlightDate, day) });
      const seen = last.get(a.id);
      if (!seen || day > seen.day) last.set(a.id, { day, flight: f });
    }
  }
  const now: AgeNow[] = [...last.entries()].map(([id, { flight }]) => {
    const a = airframes.get(id)!;
    return { airframeId: id, firstFlightDate: a.firstFlightDate!, days: Math.max(0, daysBetween(a.firstFlightDate!, today)), status: a.status, registration: flight.registration, typeCode: a.typeCode ?? flight.typeCode };
  });
  return { whenFlown, now, leftOut };
}

export type AgeOrder = "oldest" | "youngest";

/** Oldest or youngest first; equal ages keep the order given. */
export function byAge<T extends { days: number }>(rows: T[], order: AgeOrder): T[] {
  return [...rows].sort((a, b) => (order === "oldest" ? b.days - a.days : a.days - b.days));
}

const DAYS_A_YEAR = 365.2425;
const DAYS_A_MONTH = DAYS_A_YEAR / 12;

/** An age as Statistics and the CLI write it: "12 days" under a month, "7 months" under a year, else "24.3 years". */
export function ageText(days: number): string {
  if (days < 31) return t("view.age.days", { count: days });
  if (days < 365) return t("view.age.months", { count: Math.max(1, Math.floor(days / DAYS_A_MONTH)) });
  return t("view.age.years", { years: oneDecimal(days / DAYS_A_YEAR) });
}

/** The average of the ages given, in days, or null for none. */
export function averageAge(rows: { days: number }[]): number | null {
  return rows.length ? Math.round(rows.reduce((s, r) => s + r.days, 0) / rows.length) : null;
}

/**
 * An aircraft's status as a word, for one that is not simply flying: "Stored", "Retired", "Written off". Read from the
 * messages each time one is asked for, so it is in the interface's language.
 */
export const STATUS_WORD: Partial<Record<NonNullable<Airframe["status"]>, string>> = {
  get stored() {
    return t("view.airframeStatus.stored");
  },
  get retired() {
    return t("view.airframeStatus.retired");
  },
  get written_off() {
    return t("view.airframeStatus.written_off");
  },
};

/** The flights left out, by reason, as short phrases: "2 missing aircraft". */
export function ageLeftOutParts(left: AircraftAges["leftOut"]): string[] {
  return [
    left.noDate > 0 && t("view.age.leftOut.noDate", { count: left.noDate }),
    left.noAircraft > 0 && t("view.age.leftOut.noAircraft", { count: left.noAircraft }),
    left.noFirstFlight > 0 && t("view.age.leftOut.noFirstFlight", { count: left.noFirstFlight }),
    left.beforeFirstFlight > 0 && t("view.age.leftOut.beforeFirstFlight", { count: left.beforeFirstFlight }),
  ].filter((x): x is string => !!x);
}

/** The flights left out, as one line: "Excluded: 2 missing aircraft · 1 missing first flight date". */
export function ageLeftOutText(left: AircraftAges["leftOut"]): string | null {
  const parts = ageLeftOutParts(left);
  return parts.length ? t("view.age.excluded", { reasons: parts.join(" · ") }) : null;
}

/** "Age today" for an aircraft no longer flying: the log has no retirement date. Without a full stop. */
export const ageTodayNote = (): string => t("view.age.todayNote");

