import { describe, expect, it } from "vitest";
import { geoOrthographic } from "d3-geo";
import { turnFor } from "./globeZoom.ts";

describe("turnFor", () => {
  const at = (rot: [number, number], p: [number, number]) => geoOrthographic().rotate([rot[0], rot[1], 0]).scale(1).translate([0, 0])(p)!;

  it("shows the place at the offset asked for, on the near side", () => {
    const cases: { p: [number, number]; u: number; v: number; rot: [number, number] }[] = [
      { p: [2.35, 48.86], u: 0.3, v: -0.2, rot: [-10, -40] },
      { p: [139.7, 35.7], u: -0.6, v: 0.5, rot: [-130, -20] },
      { p: [-74, 40.7], u: 0, v: 0, rot: [80, -30] },
      { p: [151.2, -33.9], u: 0.45, v: 0.4, rot: [-150, 30] },
      { p: [-170, 10], u: -0.2, v: 0.1, rot: [175, 0] },
    ];
    for (const { p, u, v, rot } of cases) {
      const turn = turnFor(p, u, v, rot)!;
      expect(turn).not.toBeNull();
      const [x, y] = at(turn, p);
      expect(x).toBeCloseTo(u, 9);
      expect(-y).toBeCloseTo(v, 9);
      expect(Math.abs(turn[1])).toBeLessThanOrEqual(89);
      // On the near side: the place's distance from the centre under a quarter turn.
      const centre: [number, number] = [-turn[0], -turn[1]];
      const cos = Math.sin(p[1] * (Math.PI / 180)) * Math.sin(centre[1] * (Math.PI / 180)) + Math.cos(p[1] * (Math.PI / 180)) * Math.cos(centre[1] * (Math.PI / 180)) * Math.cos((p[0] - centre[0]) * (Math.PI / 180));
      expect(cos).toBeGreaterThan(0);
    }
  });

  it("keeps the turn it is at when the place is already there", () => {
    const rot: [number, number] = [-20, -45];
    const p: [number, number] = [30, 50];
    const [x, y] = at(rot, p);
    const turn = turnFor(p, x, -y, rot)!;
    expect(turn[0]).toBeCloseTo(rot[0], 9);
    expect(turn[1]).toBeCloseTo(rot[1], 9);
  });

  it("stays within a turn of where it was", () => {
    const turn = turnFor([10, 0], 0, 0, [710, 0])!;
    expect(turn[0]).toBeCloseTo(710, 9);
  });

  it("gives up where only a rolled globe could show the place", () => {
    expect(turnFor([0, 85], 0.5, 0, [0, -60])).toBeNull();
  });
});
