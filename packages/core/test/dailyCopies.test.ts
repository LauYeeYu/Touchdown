// Daily copies of the log (docs/12, "Daily copies"): their names, the log's fingerprint, and which copies are kept.

import { describe, expect, it } from "vitest";
import { addDays, dailyCopiesToKeep, dailyCopyName, logFingerprint, parseDailyCopyName } from "../src/index.ts";
import { newStore } from "./fixtures.ts";

const copy = (day: string, fp = "0000000a") => dailyCopyName(day, fp);
/** A copy made on every day from `from` to `to`. */
const everyDay = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(copy(d));
  return out;
};
const daysOf = (names: Set<string>) => [...names].map((n) => parseDailyCopyName(n)!.day).sort();

describe("daily copies", () => {
  it("are named by their day and the log's fingerprint", () => {
    expect(dailyCopyName("2026-11-07", "3fa9c2d1")).toBe("touchdown-backup-2026-11-07-3fa9c2d1.zip");
    expect(parseDailyCopyName("touchdown-backup-2026-11-07-3fa9c2d1.zip")).toEqual({ day: "2026-11-07", fingerprint: "3fa9c2d1" });
    for (const other of ["touchdown-backup-2026-11-07.zip", "notes.txt", "touchdown-backup-2026-11-07-3FA9C2D1.zip"]) expect(parseDailyCopyName(other)).toBeNull();
  });

  it("keep the log as it was at the end of each of the last 7 days, 8 weeks and 12 months, and of each year", () => {
    // A copy every day for two years; today is Saturday 7 November 2026.
    const today = "2026-11-07";
    const kept = daysOf(dailyCopiesToKeep(everyDay("2024-11-01", today), today));
    expect(kept).toEqual([
      // The end of each year before.
      "2024-12-31", "2025-12-31",
      // The end of each of the last 12 months (this month's is today).
      "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31",
      // The end of each of the last 8 weeks, which end on Sunday.
      "2026-09-20", "2026-09-27", "2026-09-30", "2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25", "2026-10-31",
      // The last 7 days.
      "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07",
    ]);
  });

  it("keep the copy that holds the log at each point, whatever day it was made", () => {
    // Copies only on days the log changed: two in January, one in March, then none until today.
    const names = [copy("2026-01-10"), copy("2026-01-20"), copy("2026-03-04"), "notes.txt"];
    const today = "2026-11-07";
    // 20 January's copy is the log as it was at the end of January and February; 10 January's is not needed.
    expect(daysOf(dailyCopiesToKeep(names, today))).toEqual(["2026-01-20", "2026-03-04"]);
    expect([...dailyCopiesToKeep(names, today)]).not.toContain("notes.txt");
    // Kept as days pass: nothing falls out while it is still the log at some point.
    expect(daysOf(dailyCopiesToKeep(names, "2026-12-31"))).toEqual(["2026-01-20", "2026-03-04"]);
    // Next year, the end of 2026 still needs the March copy, and the January one goes once January is over a year ago.
    expect(daysOf(dailyCopiesToKeep(names, "2027-02-10"))).toEqual(["2026-03-04"]);
  });

  it("keep the same copies as days pass", () => {
    let names = everyDay("2026-01-01", "2026-01-01");
    for (let day = "2026-01-02"; day <= "2026-08-31"; day = addDays(day, 1)) {
      names.push(copy(day));
      const keep = dailyCopiesToKeep(names, day);
      names = names.filter((n) => keep.has(n));
    }
    expect(names.map((n) => parseDailyCopyName(n)!.day)).toEqual([
      "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30",
      "2026-07-19", "2026-07-26", "2026-07-31", "2026-08-02", "2026-08-09", "2026-08-16", "2026-08-23",
      "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31",
    ]);
  });

  it("keep one of two copies made on one day, and a copy dated after today", () => {
    const names = [copy("2026-03-25"), copy("2026-03-25", "0000000b"), copy("2026-03-27")];
    expect([...dailyCopiesToKeep(names, "2026-03-26")]).toEqual([names[2], names[1]]);
  });

  it("fingerprint the log by its rows' versions, the same on any device", () => {
    const a = newStore();
    const fp = logFingerprint(a);
    const row = a.insert("flights", { flightNumber: "XY1", scheduledDate: "2026-03-01" });
    const one = logFingerprint(a);
    expect(one).not.toBe(fp);
    expect(one).toMatch(/^[0-9a-f]{8}$/);
    const b = newStore();
    b.load("flights", [row]);
    expect(logFingerprint(b)).toBe(one);
    a.update("flights", row.id, { seat: "1A" });
    expect(logFingerprint(a)).not.toBe(one);
  });
});
