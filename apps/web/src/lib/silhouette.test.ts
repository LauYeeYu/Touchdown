import { describe, expect, it } from "vitest";
import { extentOf, planformParts, planformPath, type Planform, type Shape } from "./silhouette.ts";

// Made-up airliners, in metres: a long narrow twin and a broad four-engined one.
const twin: Shape = { kind: "jet", wing: { at: 0.37, root: 0.16, tip: 0.24 }, engines: { wing: [0.34] }, stab: { span: 0.34, at: 0.86, sweep: 30 } };
const long: Planform = { length: 47, span: 38, width: 3.8, sweep: 25, shape: twin };
const broad: Planform = { length: 73, span: 80, width: 7.1, sweep: 33, shape: { ...twin, wing: { at: 0.33, root: 0.26, tip: 0.2, device: "winglet" }, engines: { wing: [0.37, 0.67] } } };

const signedArea = (part: [number, number][]) => part.reduce((s, [x1, y1], i) => {
  const [x2, y2] = part[(i + 1) % part.length]!;
  return s + x1 * y2 - x2 * y1;
}, 0);

describe("a type seen from above", () => {
  it("is as long and as wide as its figures, the nose at the top and the wings level", () => {
    for (const p of [long, broad]) {
      const [x0, y0, x1, y1] = extentOf(planformParts(p));
      // The nose at 0, the tail cone at the length; a jet's nacelles may reach a little ahead of the nose's line only on
      // a very short fuselage, so the length is the fuselage's.
      expect(y0).toBeCloseTo(0, 1);
      expect(y1).toBeCloseTo(p.length, 0);
      // Tip to tip within a few per cent: winglets add a little.
      expect(x1 - x0).toBeGreaterThan(p.span * 0.98);
      expect(x1 - x0).toBeLessThan(p.span * 1.04);
      expect(x0).toBeCloseTo(-x1, 6);
    }
  });

  it("turns every part the same way, so filling them together never leaves a hole", () => {
    for (const p of [long, broad, { ...long, shape: { ...twin, kind: "prop" as const, engines: { wing: [0.3] }, prop: 3.9 } }]) {
      const parts = planformParts(p);
      expect(parts.length).toBeGreaterThan(5);
      for (const part of parts) expect(signedArea(part)).toBeGreaterThan(0);
    }
    expect(planformPath(planformParts(long))).toMatch(/^M[\d.-]+ [\d.-]+L/);
  });

  it("draws the broad one broader and the long one longer, as their figures say", () => {
    const [lx0, , lx1, ly1] = extentOf(planformParts(long));
    const [bx0, , bx1, by1] = extentOf(planformParts(broad));
    expect((lx1 - lx0) / ly1).toBeLessThan(1);
    expect((bx1 - bx0) / by1).toBeGreaterThan(1);
  });
});
