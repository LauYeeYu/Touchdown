// Route extension (docs/23-tracks-and-maps.md, "Route extension"): how much further a flight flew than the great
// circle, from its recorded track. Made-up flights and tracks between Boston and New York.

import { describe, expect, it } from "vitest";
import { attachTrack, haversineKm, type TrackPointInput } from "../src/index.ts";
import { extensionPercent, routeExtension, routeExtensionByRoute, routeExtensions } from "../src/view/index.ts";
import { newStore, ref } from "./fixtures.ts";

const BOS = { lat: 42.3643, lon: -71.0052 };
const JFK = { lat: 40.6398, lon: -73.7789 };
const START = 1772373480;

/** Positions along the way, 30 s apart, through each of `via` in turn. */
function path(via: { lat: number; lon: number }[], each = 60, speed = 300): TrackPointInput[] {
  const out: TrackPointInput[] = [];
  for (let leg = 0; leg < via.length - 1; leg++) {
    const a = via[leg]!;
    const b = via[leg + 1]!;
    for (let i = leg ? 1 : 0; i <= each; i++) {
      const k = i / each;
      out.push({ t: START + out.length * 30, lat: a.lat + (b.lat - a.lat) * k, lon: a.lon + (b.lon - a.lon) * k, altitudeFt: 20000, groundSpeedKt: speed, headingDeg: 225 });
    }
  }
  return out;
}

function flight(store: ReturnType<typeof newStore>, from = "ap_kbos", to = "ap_kjfk") {
  return store.insert("flights", { flightNumber: "XY101", fromAirportId: from, toAirportId: to, takeoffAt: "2026-03-01T08:58-05:00", landingAt: "2026-03-01T10:02-05:00" });
}

const track = (store: ReturnType<typeof newStore>, flightId: string, points: TrackPointInput[], coverage: "complete" | "partial" = "complete") =>
  attachTrack(store, flightId, points, { provider: "fr24_csv", attribution: "test", coverage });

describe("route extension", () => {
  it("is about nothing along the great circle, and the extra distance of a dog-leg", () => {
    const store = newStore();
    const straight = flight(store);
    track(store, straight.id, path([BOS, JFK]));
    const s = routeExtension(store, ref, straight)!;
    expect(s.greatCircleKm).toBeCloseTo(haversineKm(BOS, JFK), 6);
    expect(s.percent).toBeLessThan(0.5);
    expect(s.minimum).toBe(false);

    const corner = { lat: BOS.lat, lon: JFK.lon };
    const dogleg = flight(store);
    track(store, dogleg.id, path([BOS, corner, JFK]));
    const d = routeExtension(store, ref, dogleg)!;
    const flown = haversineKm(BOS, corner) + haversineKm(corner, JFK);
    expect(d.flownKm).toBeCloseTo(flown, 0);
    expect(d.extraKm).toBeCloseTo(flown - d.greatCircleKm, 0);
    expect(d.percent).toBeGreaterThan(30);
  });

  it("leaves out taxiing, and is a minimum across a gap in the recording", () => {
    const store = newStore();
    const plain = flight(store);
    track(store, plain.id, path([BOS, JFK]));
    // Slow positions on the ground, a few km out of the way at each end.
    const taxiing = flight(store);
    const out = path([BOS, JFK]);
    const ground = (at: { lat: number; lon: number }, t: number): TrackPointInput => ({ t, lat: at.lat + 0.03, lon: at.lon + 0.03, altitudeFt: 0, groundSpeedKt: 12, headingDeg: 90 });
    track(store, taxiing.id, [ground(BOS, START - 300), ...out, ground(JFK, out[out.length - 1]!.t + 300)]);
    expect(routeExtension(store, ref, taxiing)!.flownKm).toBeCloseTo(routeExtension(store, ref, plain)!.flownKm, 6);

    const gappy = flight(store);
    const all = path([BOS, JFK]);
    track(store, gappy.id, [...all.slice(0, 15), ...all.slice(45)]);
    expect(routeExtension(store, ref, gappy)!.minimum).toBe(true);
  });

  it("counts the stretch a track stops short of as the great circle, a minimum, and needs a track", () => {
    const store = newStore();
    const f = flight(store);
    const all = path([BOS, { lat: BOS.lat, lon: JFK.lon }, JFK]);
    track(store, f.id, all.slice(0, 80), "partial");
    const e = routeExtension(store, ref, f)!;
    expect(e.minimum).toBe(true);
    const last = all[79]!;
    expect(e.flownKm).toBeCloseTo(haversineKm(BOS, { lat: BOS.lat, lon: JFK.lon }) + haversineKm({ lat: BOS.lat, lon: JFK.lon }, last) + haversineKm(last, JFK), 0);
    expect(routeExtension(store, ref, flight(store))).toBeNull();
  });

  it("is totalled by route, both ways as one, for routes with two or more such flights", () => {
    const store = newStore();
    const corner = { lat: BOS.lat, lon: JFK.lon };
    const out = flight(store);
    track(store, out.id, path([BOS, corner, JFK]));
    const back = flight(store, "ap_kjfk", "ap_kbos");
    track(store, back.id, path([JFK, BOS]));
    const alone = flight(store, "ap_kbos", "ap_katl");
    track(store, alone.id, path([BOS, { lat: 33.6367, lon: -84.4281 }]));
    const flights = store.all("flights");
    const ext = routeExtensions(store, ref, flights);
    expect(ext.size).toBe(3);
    const routes = routeExtensionByRoute(flights, ext, ref);
    expect(routes.map((r) => [r.route, r.flights])).toEqual([["BOS-JFK", 2]]);
    const [r] = routes;
    expect(r!.percent).toBeCloseTo(((ext.get(out.id)!.extraKm + ext.get(back.id)!.extraKm) / (2 * haversineKm(BOS, JFK))) * 100, 6);
  });

  it("reads as a percentage", () => {
    expect(extensionPercent(8.4)).toBe("+8.4%");
    expect(extensionPercent(12.6)).toBe("+13%");
    expect(extensionPercent(8.04)).toBe("+8%");
    expect(extensionPercent(0.02)).toBe("under +0.1%");
  });
});
