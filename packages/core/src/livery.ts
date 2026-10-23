// What special livery an aircraft wore on a day, from the user's other records of it. A special livery is
// worn for months or years, then painted over, so only records near the day say anything (docs/20,
// C-LIVERY-MISSING; docs/21, "Special livery").

import { daysBetween } from "./time/index.ts";

/** A special livery and the day of the record it comes from. */
export interface WornLivery {
  name: string;
  on: string;
}

export interface LiveryRecord {
  date: string | null;
  specialLivery: string | null;
}

/** A livery is taken to be still worn this many days after the last record of it. */
export const LIVERY_KEPT_DAYS = 365;

const liveryKey = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

const worn = (records: LiveryRecord[]) =>
  records.filter((r): r is { date: string; specialLivery: string } => !!r.date && !!r.specialLivery?.trim()).sort((a, b) => a.date.localeCompare(b.date));

/** The special livery recorded nearest to `date`, however far: what to ask the user about. */
export function nearestLivery(records: LiveryRecord[], date: string): WornLivery | null {
  const near = worn(records).sort((a, b) => Math.abs(daysBetween(a.date, date)) - Math.abs(daysBetween(b.date, date)) || b.date.localeCompare(a.date))[0];
  return near ? { name: near.specialLivery, on: near.date } : null;
}

/**
 * The special livery the aircraft surely wore on `date`: the same livery is recorded before and after it, or
 * the last record before it has one and is less than LIVERY_KEPT_DAYS old.
 */
export function liveryAround(records: LiveryRecord[], date: string): WornLivery | null {
  const list = worn(records);
  const before = list.filter((r) => r.date <= date).at(-1);
  const after = list.find((r) => r.date >= date);
  if (!before) return null;
  if (after) return liveryKey(after.specialLivery) === liveryKey(before.specialLivery) ? { name: before.specialLivery, on: before.date } : null;
  return daysBetween(before.date, date) <= LIVERY_KEPT_DAYS ? { name: before.specialLivery, on: before.date } : null;
}
