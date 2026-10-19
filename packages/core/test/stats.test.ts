import { describe, expect, it } from "vitest";
import { combinedStats, DIMENSIONS, flightStats, normaliseFlight, normaliseSighting, pivot, resolveAirframes, sightingStats } from "../src/index.ts";
import { newStore, ref } from "./fixtures.ts";

function setup() {
  const store = newStore();
  const fl = (from: string, to: string, date: string, airline: string, reg: string, type: string) =>
    store.insert("flights", normaliseFlight({ scheduledDate: date, fromRaw: from, toRaw: to, airlineRaw: airline, registrationRaw: reg, typeCodeRaw: type }, ref));
  fl("BOS", "SEA", "2025-01-02", "DL", "N1X", "A21N");
  fl("SEA", "BOS", "2025-01-09", "DL", "N2X", "A21N");
  fl("BOS", "JFK", "2025-02-01", "UA", "N3X", "B738");
  fl("JFK", "BOS", "2025-02-02", "UA", "N1X", "A21N");
  store.insert("flights", normaliseFlight({ scheduledDate: "2025-03-01", airlineRaw: "DL" }, ref));
  const si = (reg: string, date: string, op: string, type: string, livery: string | null = null) =>
    store.insert("sightings", normaliseSighting({ registrationRaw: reg, seenOn: date, airportRaw: "KBOS", operatorRaw: op, typeCodeRaw: type, specialLivery: livery }, ref));
  si("N1X", "2025-03-01", "DAL", "A21N");
  si("N1X", "2025-04-01", "DAL", "A21N");
  si("N5X", "2025-04-01", "UAL", "B738", "Retro Livery");
  si("N6X", "2025-04-01", "UAL", "B752");
  store.insert("sightings", normaliseSighting({ seenOn: "2025-04-01", airportRaw: "KBOS", operatorRaw: "UAL" }, ref));
  resolveAirframes(store, ref);
  return { store, ctx: { ref, airframes: new Map(store.all("airframes").map((a) => [a.id, a])) } };
}

describe("flight statistics", () => {
  it("counts routes without direction and lists ties", () => {
    const { store, ctx } = setup();
    const s = flightStats(store.all("flights"), ctx);
    expect(s.flights).toBe(5);
    expect(s.byRoute.items.slice(0, 2)).toEqual([{ key: "BOS-JFK", count: 2 }, { key: "BOS-SEA", count: 2 }]);
    expect(s.byRoute.top).toEqual(["BOS-JFK", "BOS-SEA"]);
    expect(s.byRoute.leftOut).toBe(1);
    expect(s.byAirline.top).toEqual(["op_dal"]);
    expect(s.aircraft).toMatchObject({ value: 3, leftOut: 1, provisional: 3 });
    expect(s.distanceKm.leftOut).toBe(1);
    expect(s.byFamily.items[0]).toEqual({ key: "A320", count: 3 });
    expect(s.airportVisits.top).toEqual(["ap_kbos"]);
  });
});

describe("sighting statistics", () => {
  it("counts aircraft as distinct airframes, not sightings", () => {
    const { store, ctx } = setup();
    const s = sightingStats(store.all("sightings"), ctx);
    expect(s.sightings).toBe(5);
    expect(s.aircraft).toMatchObject({ value: 3, leftOut: 1 });
    expect(s.byAirline.items).toEqual([{ key: "op_ual", count: 2 }, { key: "op_dal", count: 1 }]);
    expect(s.byAirline.leftOut).toBe(1);
    expect(s.specialLiveryAircraft.value).toBe(1);
    expect(s.repeats).toHaveLength(1);
    expect(s.newPerDay).toEqual([{ key: "2025-03-01", count: 1 }, { key: "2025-04-01", count: 2 }]);
  });
});

describe("combined and pivot", () => {
  it("finds aircraft flown and photographed", () => {
    const { store, ctx } = setup();
    const c = combinedStats(store.all("flights"), store.all("sightings"), ctx);
    expect(c.flownAndPhotographed).toHaveLength(1);
    expect(c.spottedNeverFlown).toEqual(["B752"]);
  });

  it("pivots family by airline, measured in aircraft", () => {
    const { store, ctx } = setup();
    const dim = (id: string) => DIMENSIONS.find((d) => d.id === id)!;
    const p = pivot("sightings", store.all("sightings"), dim("airline"), dim("family"), "aircraft", ctx);
    expect(p.rows).toEqual(["op_ual", "op_dal"]);
    expect(p.cells.get("op_ual\u0000B737")).toBe(1);
    expect(p.leftOut).toBe(1);
  });
});

import { airportVisits } from "../src/index.ts";

describe("airport visits", () => {
  it("counts a landing followed by a departure within 24 hours as one transit", () => {
    const store = newStore();
    const fl = (from: string, to: string, takeoff: string, landing: string) =>
      store.insert("flights", normaliseFlight({ scheduledDate: takeoff.slice(0, 10), fromRaw: from, toRaw: to, takeoffAt: takeoff, landingAt: landing }, ref));
    fl("BOS", "JFK", "2025-03-01T08:00-05:00", "2025-03-01T09:10-05:00");
    fl("JFK", "LHR", "2025-03-01T18:00-05:00", "2025-03-02T06:00+00:00"); // connection at JFK
    fl("LHR", "JFK", "2025-03-10T10:00+00:00", "2025-03-10T13:00-04:00"); // ends at JFK
    fl("JFK", "BOS", "2025-03-14T09:00-04:00", "2025-03-14T10:10-04:00"); // four days later: a departure
    const v = airportVisits(store.all("flights"), "ap_kjfk");
    expect(v.transits).toHaveLength(1);
    expect(v.landings).toHaveLength(1);
    expect(v.departures).toHaveLength(1);
    const b = airportVisits(store.all("flights"), "ap_kbos");
    expect([b.departures.length, b.landings.length, b.transits.length]).toEqual([1, 1, 0]);
  });
});
