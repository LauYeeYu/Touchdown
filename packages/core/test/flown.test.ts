// The distance a flight flew along its recorded track (docs/23-tracks-and-maps.md, "Distance"): the flight's distance
// wherever its track is here, before the great circle. Made-up flights and tracks around Boston and New York.

import { describe, expect, it } from "vitest";
import { attachTrack, flightDistanceKm, flightStats, flownDistances, greatCircleKm, haversineKm, removeTrack, type TrackPointInput } from "../src/index.ts";
import { sortedFlights } from "../src/view/index.ts";
import { newStore, ref } from "./fixtures.ts";

const BOS = { lat: 42.3643, lon: -71.0052 };
const JFK = { lat: 40.6398, lon: -73.7789 };
const START = 1772373480;

/** Positions 30 s apart through each of `via` in turn, in the air. */
function path(via: { lat: number; lon: number }[], each = 60): TrackPointInput[] {
  const out: TrackPointInput[] = [];
  for (let leg = 0; leg < via.length - 1; leg++) {
    const a = via[leg]!;
    const b = via[leg + 1]!;
    for (let i = leg ? 1 : 0; i <= each; i++) {
      const k = i / each;
      out.push({ t: START + out.length * 30, lat: a.lat + (b.lat - a.lat) * k, lon: a.lon + (b.lon - a.lon) * k, altitudeFt: 5000, groundSpeedKt: 200, headingDeg: 90 });
    }
  }
  return out;
}

const attach = (store: ReturnType<typeof newStore>, flightId: string, points: TrackPointInput[]) => attachTrack(store, flightId, points, { provider: "fr24_csv", attribution: "test", coverage: "complete" });

describe("the distance flown", () => {
  it("is the flight's distance once its track is here, the great circle before", () => {
    const store = newStore();
    const f = store.insert("flights", { flightNumber: "XY101", fromAirportId: "ap_kbos", toAirportId: "ap_kjfk", scheduledDate: "2026-03-01" });
    const gc = greatCircleKm(f, ref)!;
    expect(flightDistanceKm(f, ref, flownDistances(store, ref))).toBeCloseTo(gc, 6);

    const corner = { lat: BOS.lat, lon: JFK.lon };
    attach(store, f.id, path([BOS, corner, JFK]));
    const flown = flownDistances(store, ref).get(f.id)!;
    expect(flown.km).toBeCloseTo(haversineKm(BOS, corner) + haversineKm(corner, JFK), 0);
    expect(flown.minimum).toBe(false);
    expect(flightDistanceKm(f, ref, flownDistances(store, ref))).toBeCloseTo(flown.km, 6);
    // Statistics and the pages' views use it too.
    expect(flightStats([f], { ref, airframes: new Map(), flown: flownDistances(store, ref) }).distanceKm.value).toBeCloseTo(flown.km, 6);
    expect(sortedFlights(store, ref)[0]!.km).toBeCloseTo(flown.km, 6);
    // A distance the user entered still comes first.
    const entered = store.update("flights", f.id, { distanceKmOverride: 300 });
    expect(flightDistanceKm(entered, ref, flownDistances(store, ref))).toBe(300);

    // The track gone, the great circle again.
    store.update("flights", f.id, { distanceKmOverride: null });
    removeTrack(store, f.id);
    expect(flownDistances(store, ref).has(f.id)).toBe(false);
  });

  it("gives a flight that lands where it took off its distance", () => {
    const store = newStore();
    const local = store.insert("flights", { fromAirportId: "ap_kbos", toAirportId: "ap_kbos", registration: "N123AB", scheduledDate: "2026-03-01" });
    expect(flightDistanceKm(local, ref, flownDistances(store, ref))).toBe(0);
    const out = { lat: 42.6, lon: -70.7 };
    attach(store, local.id, path([BOS, out, BOS]));
    expect(flightDistanceKm(local, ref, flownDistances(store, ref))).toBeCloseTo(2 * haversineKm(BOS, out), 0);
  });

  it("is a minimum across a gap, which counts as a straight line", () => {
    const store = newStore();
    const f = store.insert("flights", { flightNumber: "XY102", fromAirportId: "ap_kbos", toAirportId: "ap_kjfk", scheduledDate: "2026-03-01" });
    const points = path([BOS, JFK]);
    // Nothing received for 20 minutes over the middle third.
    const gapped = [...points.slice(0, 20), ...points.slice(40).map((p) => ({ ...p, t: p.t + 1200 }))];
    attach(store, f.id, gapped);
    const d = flownDistances(store, ref).get(f.id)!;
    expect(d.minimum).toBe(true);
    expect(d.km).toBeCloseTo(haversineKm(BOS, JFK), 0);
  });

  it("is worked out again only when the flights, tracks or airports change", () => {
    const store = newStore();
    const f = store.insert("flights", { fromAirportId: "ap_kbos", toAirportId: "ap_kjfk", scheduledDate: "2026-03-01" });
    attach(store, f.id, path([BOS, JFK]));
    const first = flownDistances(store, ref);
    store.insert("sightings", { seenOn: "2026-03-02", registrationRaw: "N123AB" });
    expect(flownDistances(store, ref)).toBe(first);
    store.update("flights", f.id, { notes: "Bumpy" });
    expect(flownDistances(store, ref)).not.toBe(first);
  });
});
