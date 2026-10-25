import { describe, expect, it } from "vitest";
import { DIMENSIONS, phaseIndex, phasesOf, pivot, RefIndex, setPhases, settlePhases, sightingStats, Store, type Sighting } from "../src/index.ts";
import { newStore, refTables } from "./fixtures.ts";

// Every registration and date here is made up.
const ref = new RefIndex(refTables);

/** A sighting as an older version wrote it: its phase in the record, other phases in its notes. */
function olderSighting(store: Store, phase: string | null, notes: string | null) {
  return store.insert("sightings", { seenOn: "2026-04-02", registration: "N920ZZ", phase: phase as never, notes });
}

describe("a sighting's phases", () => {
  it("moves a phase and the phases an older import kept in the notes into the sighting's phases", () => {
    const store = newStore();
    const s = olderSighting(store, "taxiing", "Nice light; Also taking off; Also parked");
    expect(phasesOf(store, s.id)).toEqual(["taxiing"]);

    settlePhases(store);
    expect(store.get("sightings", s.id)).toMatchObject({ phase: null, notes: "Nice light" });
    expect(phasesOf(store, s.id)).toEqual(["taking_off", "taxiing", "parked"]);
    // Nothing left to move: nothing changes.
    let writes = 0;
    const stop = store.subscribe((c) => (writes += c.length));
    settlePhases(store);
    stop();
    expect(writes).toBe(0);
  });

  it("makes the same rows on two devices that move the same sighting's phase", () => {
    const a = new Store({ deviceId: "dev_a", now: () => Date.UTC(2026, 0, 1) });
    const s = olderSighting(a, "landing", null);
    const b = new Store({ deviceId: "dev_b", now: () => Date.UTC(2026, 0, 2) });
    b.load("sightings", [a.peek("sightings", s.id)! as never]);
    settlePhases(a);
    settlePhases(b);
    expect(a.all("sighting_phases").map((p) => p.id)).toEqual(b.all("sighting_phases").map((p) => p.id));
  });

  it("sets phases in the fixed order, whatever order they come in", () => {
    const store = newStore();
    const s = store.insert("sightings", { seenOn: "2026-04-02", registration: "N921ZZ" });
    setPhases(store, s.id, ["parked", "landing", "parked"]);
    expect(phasesOf(store, s.id)).toEqual(["landing", "parked"]);
    setPhases(store, s.id, ["taxiing"]);
    expect(phasesOf(store, s.id)).toEqual(["taxiing"]);
    expect(store.all("sighting_phases")).toHaveLength(1);
  });

  it("counts a sighting once under each of its phases in statistics", () => {
    const store = newStore();
    const one = store.insert("sightings", { seenOn: "2026-04-02", registration: "N922ZZ", airportId: "ap_kbos" });
    const two = store.insert("sightings", { seenOn: "2026-04-03", registration: "N923ZZ", airportId: "ap_kbos" });
    setPhases(store, one.id, ["landing", "taxiing"]);
    setPhases(store, two.id, ["landing"]);
    const ctx = { ref, airframes: new Map(), phases: phaseIndex(store) };
    const sightings = store.all("sightings") as Sighting[];

    expect(sightingStats(sightings, ctx).byPhase.items).toEqual([
      { key: "landing", count: 2 },
      { key: "taxiing", count: 1 },
    ]);
    const phase = DIMENSIONS.find((d) => d.id === "phase")!;
    const airport = DIMENSIONS.find((d) => d.id === "airport")!;
    const byPhase = pivot("sightings", sightings, phase, null, "records", ctx);
    expect(Object.fromEntries(byPhase.rowTotals)).toEqual({ landing: 2, taxiing: 1 });
    // As columns, a sighting with two phases counts once in its row's total.
    const byAirport = pivot("sightings", sightings, airport, phase, "records", ctx);
    expect(byAirport.rowTotals.get("ap_kbos")).toBe(2);
  });
});
