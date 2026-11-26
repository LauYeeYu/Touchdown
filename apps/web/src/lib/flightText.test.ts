import { describe, expect, it } from "vitest";
import { flightWhen } from "./flightText.ts";

describe("when a flight flew, for its lead sentence", () => {
  it("lands an evening flight in the small hours after midnight, that same night", () => {
    expect(flightWhen("2024-08-20T19:10+08:00", "2024-08-21T00:35+08:00", 325)).toEqual({ kind: "evening", landing: "afterMidnight", landingPart: "night", days: 1 });
  });

  it("calls a flight overnight when it lands the next morning", () => {
    expect(flightWhen("2024-05-01T22:30-07:00", "2024-05-02T06:45-04:00", 315)).toMatchObject({ kind: "overnight", landing: "nextDay", landingPart: "morning" });
  });

  it("keeps a long-haul flight long-haul when it lands after midnight", () => {
    expect(flightWhen("2024-03-01T10:00+00:00", "2024-03-02T02:00+05:00", 660)).toMatchObject({ kind: "longHaul", landing: "afterMidnight" });
  });

  it("lands a flight that took off in the small hours the same day", () => {
    expect(flightWhen("2024-06-01T01:00+01:00", "2024-06-01T03:00+01:00", 120)).toMatchObject({ kind: "night", landing: "sameDay" });
  });

  it("counts the days of a landing two days on by the local calendar", () => {
    expect(flightWhen("2024-06-01T23:30-10:00", "2024-06-03T05:30+12:00", 480)).toMatchObject({ kind: "overnight", landing: "later", days: 2 });
  });

  it("says nothing of a landing without its time", () => {
    expect(flightWhen("2024-06-01T08:00+01:00", null, null)).toEqual({ kind: "morning", landing: "none", landingPart: "", days: 0 });
  });
});
