import { describe, expect, it } from "vitest";
import { ageText, aircraftAges, averageAge, byAge, outOfService } from "../src/view/age.ts";
import type { Airframe } from "../src/index.ts";
import { newStore } from "./fixtures.ts";

// Made-up aircraft and flights.
function log() {
  const store = newStore();
  const old = store.insert("airframes", { typeCode: "B744", firstFlightDate: "1990-03-15", status: "retired" });
  const young = store.insert("airframes", { typeCode: "A21N", firstFlightDate: "2025-11-20", status: "active" });
  const unknown = store.insert("airframes", { typeCode: "B738" });
  const flight = (day: string, airframeId: string | null, registration: string) =>
    store.insert("flights", { flightNumber: "XY1", fromAirportId: "ap_kbos", toAirportId: "ap_kjfk", scheduledDate: day, airframeId, registration });
  flight("2010-03-15", old.id, "N100XX");
  flight("2015-09-01", old.id, "N101XX");
  flight("2026-01-04", young.id, "N200XX");
  flight("2024-05-01", unknown.id, "N300XX");
  flight("2025-01-01", young.id, "N200XX");
  flight("2023-06-01", null, "N400XX");
  const airframes = new Map(store.all("airframes").map((a) => [a.id, a] as const));
  return { store, airframes, old, young };
}

describe("aircraft age", () => {
  it("measures each flight from its aircraft's first flight, and leaves out what it cannot measure", () => {
    const { store, airframes, old, young } = log();
    const ages = aircraftAges(store.all("flights"), airframes, "2026-11-01");
    expect(ages.whenFlown.map((r) => [r.airframeId, r.day, r.days])).toEqual([
      [old.id, "2010-03-15", 7305],
      [old.id, "2015-09-01", 9301],
      [young.id, "2026-01-04", 45],
    ]);
    expect(ages.leftOut).toEqual({ noDate: 0, noAircraft: 1, noFirstFlight: 1, beforeFirstFlight: 1 });
  });

  it("gives each aircraft once, with the registration it was last flown under, and its status as recorded", () => {
    const { store, airframes, old, young } = log();
    const now = aircraftAges(store.all("flights"), airframes, "2026-11-01").now;
    expect(now.map((r) => [r.airframeId, r.registration, r.firstFlightDate, r.days, r.status])).toEqual([
      [old.id, "N101XX", "1990-03-15", 13380, "retired"],
      [young.id, "N200XX", "2025-11-20", 346, "active"],
    ]);
    expect(now.map((r) => outOfService(r.status))).toEqual([true, false]);
    expect(outOfService("written_off" as Airframe["status"])).toBe(true);
    expect(outOfService("stored" as Airframe["status"])).toBe(false);
  });

  it("sorts oldest or youngest first, and averages", () => {
    const rows = [{ days: 40 }, { days: 9000 }, { days: 400 }];
    expect(byAge(rows, "oldest").map((r) => r.days)).toEqual([9000, 400, 40]);
    expect(byAge(rows, "youngest").map((r) => r.days)).toEqual([40, 400, 9000]);
    expect(averageAge(rows)).toBe(3147);
    expect(averageAge([])).toBeNull();
  });

  it("writes days under a month, months under a year, then years to one decimal", () => {
    expect([ageText(0), ageText(1), ageText(30), ageText(31), ageText(45), ageText(364), ageText(365), ageText(9301)]).toEqual([
      "0 days",
      "1 day",
      "30 days",
      "1 month",
      "1 month",
      "11 months",
      "1.0 years",
      "25.5 years",
    ]);
  });
});
