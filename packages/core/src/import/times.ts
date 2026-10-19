// Building date-times from a date and separate clock times (docs/21-import-export.md,
// "Building date-times from clock times").

import { formatOffset, parseClock, parseDateTime, toZoned, zonedInstant, addDays } from "../time/index.ts";
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

export function buildFlightTimes(x: ClockInputs): BuiltTimes {
  const issues: ImportIssue[] = [];
  const out: BuiltTimes = { boardingAt: null, takeoffAt: null, landingAt: null, issues };
  const boardingClock = x.boarding && parseClock(x.boarding) ? x.boarding : null;
  const takeoffClock = x.takeoff && parseClock(x.takeoff) ? x.takeoff : null;
  const landingClock = x.landing && parseClock(x.landing) ? x.landing : null;

  let boardingMs: number | null = null;
  if (boardingClock && x.originTz) {
    boardingMs = zonedInstant(x.scheduledDate, boardingClock, x.originTz);
    out.boardingAt = boardingMs === null ? null : toZoned(boardingMs, x.originTz);
  }

  let takeoffMs: number | null = null;
  if (takeoffClock && x.originTz) {
    let day = x.scheduledDate;
    // Takeoff clock earlier than boarding: the takeoff was after midnight.
    if (boardingClock && clockMinutes(takeoffClock) < clockMinutes(boardingClock)) day = addDays(day, 1);
    takeoffMs = zonedInstant(day, takeoffClock, x.originTz);
    if (takeoffMs !== null) out.takeoffAt = toZoned(takeoffMs, x.originTz);
  }

  if (takeoffMs !== null && x.destTz) {
    if (x.durationMin) {
      const landingMs = takeoffMs + x.durationMin * 60_000;
      out.landingAt = toZoned(landingMs, x.destTz);
      if (landingClock) {
        const got = parseDateTime(out.landingAt)!.time.slice(0, 5);
        const diff = Math.abs(clockMinutes(got) - clockMinutes(landingClock));
        const off = Math.min(diff, 1440 - diff);
        if (off > 2) {
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
      // No duration: the landing is the first time at or after takeoff with this clock time.
      let day = parseDateTime(out.takeoffAt!)!.date;
      for (let i = 0; i < 3; i++) {
        const t = zonedInstant(day, landingClock, x.destTz);
        if (t !== null && t > takeoffMs) {
          out.landingAt = toZoned(t, x.destTz);
          break;
        }
        day = addDays(day, 1);
      }
    }
  }
  if (boardingMs !== null && takeoffMs !== null && boardingMs > takeoffMs) {
    issues.push({ ruleId: "V-TIMES-ORDER", severity: "error", field: "boardingAt", message: `Boarding ${boardingClock} is after takeoff ${takeoffClock}.` });
  }
  return out;
}
