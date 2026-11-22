import { setDateStyle } from "@touchdown/i18n";
import { afterEach, describe, expect, it } from "vitest";
import { dateTimeLabel, dayLong, dayMonthYear, dayShort, distance, durLong, durShort, momentLabelUtc, monthNames, nf, CABIN_LABEL } from "../src/view/format.ts";

afterEach(() => setDateStyle("language"));

describe("display formatting", () => {
  it("writes dates in the language's own way by default", () => {
    expect(dayMonthYear("2025-03-15")).toBe("15 Mar 2025");
    expect(dayShort("2025-03-15")).toBe("Sat 15 Mar");
    expect(dateTimeLabel("2025-03-15T08:05-04:00")).toBe("08:05 Sat 15 Mar · UTC−4");
    expect(monthNames()[2]).toBe("March");
  });

  it("writes dates in another regional way of the language when chosen", () => {
    setDateStyle("en-US");
    expect(dayMonthYear("2025-03-15")).toBe("Mar 15, 2025");
    expect(dayShort("2025-03-15")).toBe("Sat, Mar 15");
    expect(monthNames()[2]).toBe("March");
  });

  it("writes ISO 8601 dates when chosen, with names kept for weekdays and months alone", () => {
    setDateStyle("iso");
    expect(dayMonthYear("2025-03-15")).toBe("2025-03-15");
    expect(dayShort("2025-03-15")).toBe("Sat 03-15");
    expect(dayLong("2025-03-15")).toBe("Saturday 2025-03-15");
    expect(dateTimeLabel("2025-03-15T08:05+01:00")).toBe("08:05 Sat 03-15 · UTC+1");
    expect(monthNames()[2]).toBe("March");
  });

  it("formats numbers, durations, distances and labels from the messages", () => {
    expect(nf.format(12345)).toBe("12,345");
    expect(durLong(135)).toBe("2\u00a0h 15\u00a0min");
    expect(durLong(45)).toBe("45\u00a0min");
    expect(durShort(127)).toBe("2h\u00a007m");
    expect(distance(1000, "mi")).toBe("621\u00a0mi");
    expect(CABIN_LABEL.premium_economy).toBe("Premium economy");
    expect(Object.keys(CABIN_LABEL)).toContain("business");
  });
});

describe("another person's moment", () => {
  it("is in UTC, whatever this device's time zone, a day that is later or earlier here kept as UTC's", () => {
    // 23:30 UTC on 23 Oct is already 24 Oct in Shanghai and still 23 Oct in Los Angeles.
    expect(momentLabelUtc(Date.UTC(2026, 9, 23, 23, 30))).toBe(`${dayMonthYear("2026-10-23")}, 23:30 UTC`);
    expect(momentLabelUtc(Date.UTC(2026, 0, 2, 4, 5))).toBe(`${dayMonthYear("2026-01-02")}, 04:05 UTC`);
  });
});
