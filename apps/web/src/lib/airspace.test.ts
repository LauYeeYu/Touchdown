import { describe, expect, it } from "vitest";
import { crossesShapes, insideShape, type LonLat } from "@touchdown/core";
import { closedTo, wayFor } from "./airspace.ts";
import { trackRuns } from "./mapdata.ts";

// Airport positions (public), for made-up flights.
const AMS: LonLat = [4.76, 52.31];
const ICN: LonLat = [126.45, 37.46];
const HEL: LonLat = [24.96, 60.32];
const HND: LonLat = [139.78, 35.55];

describe("routes drawn around closed airspace, on the maps' own outlines", () => {
  it("keeps EU airlines' Amsterdam to Seoul and Helsinki to Tokyo clear of Russia, Belarus and Ukraine after 2022", () => {
    for (const [country, a, b] of [["NL", AMS, ICN], ["FI", HEL, HND]] as const) {
      const closed = closedTo(country, "2024-06-01");
      expect(closed).toHaveLength(3);
      expect(crossesShapes(a, b, closed)).toBe(true);
      const way = wayFor(a, b, closed);
      expect(way.length).toBeGreaterThan(2);
      for (let i = 1; i < way.length; i++) expect(crossesShapes(way[i - 1]!, way[i]!, closed)).toBe(false);
      for (const p of way.slice(1, -1)) expect(closed.some((s) => insideShape(p, s))).toBe(false);
    }
  });

  it("keeps the great circle for an airline that could fly over Russia, and before the closures", () => {
    expect(wayFor(AMS, ICN, closedTo("KR", "2024-06-01"))).toEqual([AMS, ICN]);
    expect(wayFor(AMS, ICN, closedTo("NL", "2019-05-01"))).toEqual([AMS, ICN]);
  });
});

describe("a recorded track's gaps", () => {
  it("are the stretches with nothing received for over ten minutes and a hundred kilometres", () => {
    const t0 = 1_767_000_000;
    // A point a minute for ten minutes, nothing for an hour, then a point a minute again.
    const before = Array.from({ length: 10 }, (_, i) => ({ at: [10 + i * 0.1, 50] as [number, number], t: t0 + i * 60 }));
    const after = Array.from({ length: 10 }, (_, i) => ({ at: [20 + i * 0.1, 48] as [number, number], t: t0 + 4200 + i * 60 }));
    const { runs, gaps } = trackRuns([...before, ...after]);
    expect(runs.map((r) => r.length)).toEqual([10, 10]);
    expect(gaps).toEqual([[before[9]!.at, after[0]!.at]]);
    // A long pause in one place (on the ground) is not a gap in the air.
    expect(trackRuns([...before, { at: before[9]!.at, t: t0 + 3600 }]).gaps).toEqual([]);
  });
});
