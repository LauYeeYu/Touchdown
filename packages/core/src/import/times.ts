// Building date-times from a date and separate clock times (docs/21-import-export.md,
// "Building date-times from clock times").

import { formatOffset, parseClock, parseDateTime, toZoned, zonedInstants, addDays } from "../time/index.ts";
import type { ImportIssue } from "./candidate.ts";

export interface ClockInputs {
  scheduledDate: string; // the row's date: the scheduled local departure date
  originTz: string | null;
  destTz: string | null;
  boarding?: string | null; // clock times, HH:MM
  takeoff?: string | null;
  landing?: string | null;
  durationMin?: number | null;
}

export interface BuiltTimes {
  boardingAt: string | null;
  takeoffAt: string | null;
  landingAt: string | null;
  issues: ImportIssue[];
}

const clockMinutes = (s: string) => {
  const c = parseClock(s)!;
  return c.h * 60 + c.m;
};

function hhmm(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Minutes between two clock times, either way round midnight. */
function clockGap(a: string, b: string): number {
  const diff = Math.abs(clockMinutes(a) - clockMinutes(b));
  return Math.min(diff, 1440 - diff);
}

const clockAt = (ms: number, tz: string) => parseDateTime(toZoned(ms, tz))!.time.slice(0, 5);

export function buildFlightTimes(x: ClockInputs): BuiltTimes {
  const issues: ImportIssue[] = [];
  const out: BuiltTimes = { boardingAt: null, takeoffAt: null, landingAt: null, issues };
  const boardingClock = x.boarding && parseClock(x.boarding) ? x.boarding : null;
  const takeoffClock = x.takeoff && parseClock(x.takeoff) ? x.takeoff : null;
  const landingClock = x.landing && parseClock(x.landing) ? x.landing : null;

  // A clock time can happen twice on the day the clocks go back (zonedInstants); the other times decide
  // which one, else the earlier is taken.
  let takeoffMs: number | null = null;
  if (takeoffClock && x.originTz) {
    let day = x.scheduledDate;
    // Takeoff clock earlier than boarding: the takeoff was after midnight.
    if (boardingClock && clockMinutes(takeoffClock) < clockMinutes(boardingClock)) day = addDays(day, 1);
    const candidates = zonedInstants(day, takeoffClock, x.originTz);
    const { durationMin, destTz } = x;
    const byLanding = candidates.length > 1 && durationMin && landingClock && destTz ? candidates.find((t) => clockGap(clockAt(t + durationMin * 60_000, destTz), landingClock) <= 2) : undefined;
    takeoffMs = byLanding ?? candidates[0] ?? null;
    if (takeoffMs !== null) out.takeoffAt = toZoned(takeoffMs, x.originTz);
  }

  let boardingMs: number | null = null;
  if (boardingClock && x.originTz) {
    const candidates = zonedInstants(x.scheduledDate, boardingClock, x.originTz);
    const t0 = takeoffMs;
    boardingMs = (t0 !== null ? candidates.filter((t) => t <= t0).pop() : undefined) ?? candidates[0] ?? null;
    out.boardingAt = boardingMs === null ? null : toZoned(boardingMs, x.originTz);
  }

  if (takeoffMs !== null && x.destTz) {
    if (x.durationMin) {
      const landingMs = takeoffMs + x.durationMin * 60_000;
      out.landingAt = toZoned(landingMs, x.destTz);
      if (landingClock) {
        const got = parseDateTime(out.landingAt)!.time.slice(0, 5);
        if (clockGap(got, landingClock) > 2) {
          // Work back from the landing clock time to say which value is likely wrong.
          const destOffset = parseDateTime(out.landingAt)!.offsetMin;
          const originOffset = parseDateTime(out.takeoffAt!)!.offsetMin;
          const impliedTakeoff = hhmm(clockMinutes(landingClock) - x.durationMin - destOffset + originOffset);
          const twelve = Math.abs(clockMinutes(impliedTakeoff) - clockMinutes(takeoffClock!)) === 720;
          const hint = twelve
            ? ` Landing ${landingClock} minus the duration gives takeoff ${impliedTakeoff}; ${takeoffClock} looks like a 12-hour clock slip.`
            : ` Landing ${landingClock} minus the duration gives takeoff ${impliedTakeoff}.`;
          issues.push({
            ruleId: "I-SOURCE-DIFF",
            severity: "warning",
            field: "landingAt",
            message: `Takeoff ${takeoffClock} plus duration ${hhmm(x.durationMin)} lands at ${got} (${formatOffset(destOffset)}), but the row says ${landingClock}.${hint}`,
          });
        }
      }
    } else if (landingClock) {
      // No duration: the landing is the first time after takeoff with this clock time.
      const t0 = takeoffMs;
      let day = parseDateTime(out.takeoffAt!)!.date;
      for (let i = 0; i < 3 && !out.landingAt; i++) {
        const t = zonedInstants(day, landingClock, x.destTz).find((t) => t > t0);
        if (t !== undefined) out.landingAt = toZoned(t, x.destTz);
        day = addDays(day, 1);
      }
    }
  }
  if (boardingMs !== null && takeoffMs !== null && boardingMs > takeoffMs) {
    issues.push({ ruleId: "V-TIMES-ORDER", severity: "error", field: "boardingAt", message: `Boarding ${boardingClock} is after takeoff ${takeoffClock}.` });
  }
  return out;
}
