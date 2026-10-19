import { describe, expect, it } from "vitest";
import { addDays, instant, offsetAt, parseDateTime, parseDuration, parseLooseDate, serialToDate, toZoned, zonedDateTime } from "../src/index.ts";

describe("date-times", () => {
  it("builds local date-times with the offset in effect", () => {
    expect(zonedDateTime("2025-03-15", "00:12", "Europe/Paris")).toBe("2025-03-15T00:12+01:00");
    expect(zonedDateTime("2025-07-01", "09:30", "Europe/London")).toBe("2025-07-01T09:30+01:00");
    expect(zonedDateTime("2025-01-01", "09:30", "Europe/London")).toBe("2025-01-01T09:30+00:00");
    expect(zonedDateTime("2025-06-11", "02:47", "Asia/Shanghai")).toBe("2025-06-11T02:47+08:00");
    expect(zonedDateTime("2025-11-02", "23:00", "America/New_York")).toBe("2025-11-02T23:00-05:00");
  });

  it("moves a time in a daylight-saving gap forward", () => {
    // 2025-03-09 02:30 does not exist in New York.
    expect(zonedDateTime("2025-03-09", "02:30", "America/New_York")).toBe("2025-03-09T03:30-04:00");
  });

  it("picks the earlier instant in an overlap", () => {
    // 2025-11-02 01:30 happens twice in New York.
    expect(zonedDateTime("2025-11-02", "01:30", "America/New_York")).toBe("2025-11-02T01:30-04:00");
  });

  it("parses stored date-times to instants", () => {
    const p = parseDateTime("2025-03-15T00:12+01:00")!;
    expect(p.date).toBe("2025-03-15");
    expect(p.offsetMin).toBe(60);
    expect(new Date(p.epochMs).toISOString()).toBe("2025-03-14T23:12:00.000Z");
    expect(instant("2025-03-15T00:12")).toBeNull();
  });

  it("expresses an instant in another zone", () => {
    const t = instant("2025-03-15T00:12+01:00")!;
    expect(toZoned(t + 7 * 3600_000, "America/New_York")).toBe("2025-03-15T02:12-04:00");
    expect(offsetAt("Asia/Kolkata", t)).toBe(330);
  });

  it("reads sheet dates and durations", () => {
    expect(serialToDate(45000)).toBe("2023-03-15");
    expect(parseLooseDate("15-Mar-2023")).toBe("2023-03-15");
    expect(parseLooseDate("2024-10-12")).toBe("2024-10-12");
    expect(parseLooseDate("31/12/2024")).toBe("2024-12-31");
    expect(parseLooseDate("31-Feb-2024")).toBeNull();
    expect(parseDuration("12:06")).toBe(726);
    expect(parseDuration("08:20:00")).toBe(500);
    expect(addDays("2024-12-31", 1)).toBe("2025-01-01");
  });
});
