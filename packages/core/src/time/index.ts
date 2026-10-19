// Date-time helpers. Every precise time is an ISO 8601 date-time whose wall-clock part is local to the
// place and whose offset is the one in effect there and then (docs/10-domain-model.md, requirement G8).
// Built on Intl, which every target runtime has; no time-zone database is shipped.

import { DATETIME_RE, isValidDate } from "../schema/validate.ts";

export interface ParsedDateTime {
  date: string; // YYYY-MM-DD, local
  time: string; // HH:MM or HH:MM:SS, local
  offsetMin: number; // minutes east of UTC
  epochMs: number;
}

export function parseDateTime(s: string): ParsedDateTime | null {
  const m = DATETIME_RE.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number) as [number, number, number, number, number];
  const sec = m[6] ? Number(m[6]) : 0;
  const off = m[7]!;
  const offsetMin = off === "Z" ? 0 : (off[0] === "-" ? -1 : 1) * (Number(off.slice(1, 3)) * 60 + Number(off.slice(4, 6)));
  const epochMs = Date.UTC(y, mo - 1, d, h, mi, sec) - offsetMin * 60_000;
  return {
    date: `${m[1]}-${m[2]}-${m[3]}`,
    time: m[6] ? `${m[4]}:${m[5]}:${m[6]}` : `${m[4]}:${m[5]}`,
    offsetMin,
    epochMs,
  };
}

/** Instant of a stored date-time, in epoch milliseconds; null if missing or malformed. */
export function instant(s: string | null | undefined): number | null {
  if (!s) return null;
  return parseDateTime(s)?.epochMs ?? null;
}

/** Local calendar date of a stored date-time (its wall-clock date). */
export function localDateOf(s: string | null | undefined): string | null {
  if (!s) return null;
  return parseDateTime(s)?.date ?? null;
}

export function formatOffset(offsetMin: number): string {
  const sign = offsetMin < 0 ? "-" : "+";
  const a = Math.abs(offsetMin);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock parts of an instant in a time zone. */
function wallParts(epochMs: number, tz: string) {
  const parts: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(new Date(epochMs))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return parts as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** UTC offset in minutes in effect in `tz` at an instant. */
export function offsetAt(tz: string, epochMs: number): number {
  const p = wallParts(epochMs, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / 60_000);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Store an instant as a local date-time in `tz`, e.g. 2025-03-15T00:12+01:00. Seconds only when non-zero. */
export function toZoned(epochMs: number, tz: string): string {
  const p = wallParts(epochMs, tz);
  const off = offsetAt(tz, epochMs);
  const sec = p.second ? `:${pad2(p.second)}` : "";
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}${sec}${formatOffset(off)}`;
}

export function toUtcIso(epochMs: number): string {
  return new Date(epochMs).toISOString().replace(/\.\d{3}Z$/, "Z");
}

const CLOCK_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

export function parseClock(s: string): { h: number; m: number; s: number } | null {
  const m = CLOCK_RE.exec(s.trim());
  if (!m) return null;
  const [h, mi, se] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  if (h > 23 || mi > 59 || se > 59) return null;
  return { h, m: mi, s: se };
}

/**
 * Every instant that shows a local wall-clock time on a date in a time zone, earliest first. Usually one;
 * two in the hour that repeats when the clocks go back. In the hour skipped when the clocks go forward no
 * instant shows the time: the one returned is the time moved forward by the change (02:30 → 03:30), as
 * Temporal's "compatible" disambiguation does.
 */
export function zonedInstants(date: string, clock: string, tz: string): number[] {
  if (!isValidDate(date)) return [];
  const c = parseClock(clock);
  if (!c) return [];
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, mo - 1, d, c.h, c.m, c.s);
  const o1 = offsetAt(tz, wall - 14 * 3_600_000);
  const o2 = offsetAt(tz, wall + 14 * 3_600_000);
  const candidates = [...new Set([wall - o1 * 60_000, wall - o2 * 60_000])].filter((t) => {
    const back = wallParts(t, tz);
    return Date.UTC(back.year, back.month - 1, back.day, back.hour, back.minute, back.second) === wall;
  });
  if (candidates.length) return candidates.sort((a, b) => a - b);
  // In a gap: use the offset before the change, which lands after the gap.
  return [wall - o1 * 60_000];
}

/** Instant of a local wall-clock time on a date in a time zone; the earlier one when the time repeats. */
export function zonedInstant(date: string, clock: string, tz: string): number | null {
  return zonedInstants(date, clock, tz)[0] ?? null;
}

/** Combine a date and a clock time into a stored date-time in the airport's zone. */
export function zonedDateTime(date: string, clock: string, tz: string): string | null {
  const t = zonedInstant(date, clock, tz);
  return t === null ? null : toZoned(t, tz);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

export function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number) as [number, number, number];
  const [yb, mb, db] = b.split("-").map(Number) as [number, number, number];
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

/** Today's date in a time zone (or the runtime's zone). */
export function todayIn(tz?: string, now = Date.now()): string {
  const p = wallParts(now, tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** Minutes between two stored date-times (b − a), or null. */
export function minutesBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  const ta = instant(a);
  const tb = instant(b);
  if (ta === null || tb === null) return null;
  return Math.round((tb - ta) / 60_000);
}

/** "HH:MM" duration text to minutes ("02:09" → 129, "12:06" → 726). */
export function parseDuration(s: string): number | null {
  const m = /^(\d{1,3}):(\d{2})(?::(\d{2}))?$/.exec(s.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Math.round(Number(m[3]) / 60) : 0);
}

/** Spreadsheet serial day number (1900 date system, as Google Sheets and Excel use) to YYYY-MM-DD. */
export function serialToDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1) return null;
  const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** Dates as typed in sheets and exports: 2023-03-15, 15-Mar-2023, 15 Mar 2023, 15/03/2023 (day first). */
export function parseLooseDate(s: string): string | null {
  const v = s.trim();
  if (!v) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (m) return normDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[- ]([A-Za-z]{3})[A-Za-z]*[- ](\d{4})$/.exec(v);
  if (m) {
    const mo = MONTHS[m[2]!.toLowerCase()];
    return mo ? normDate(Number(m[3]), mo, Number(m[1])) : null;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  if (m) return normDate(Number(m[3]), Number(m[2]), Number(m[1]));
  if (/^\d+(\.\d+)?$/.test(v)) return serialToDate(Number(v));
  return null;
}

function normDate(y: number, m: number, d: number): string | null {
  const s = `${y}-${pad2(m)}-${pad2(d)}`;
  return isValidDate(s) ? s : null;
}
