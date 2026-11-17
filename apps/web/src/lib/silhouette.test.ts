import { describe, expect, it } from "vitest";
import { RefIndex } from "@touchdown/core";
import { loadRefTables } from "@touchdown/refdata";
import { extentOf, planformLayers, planformParts, planformPath, type Planform, type Pt, type Shape } from "./silhouette.ts";
import { loadTypeInfo } from "./typeInfo.ts";

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

describe("what moves when a type is hovered", () => {
  const helicopter: Shape = { kind: "helicopter", nose: 1.1, tail: 1, boom: 0.45, wing: { at: 0, root: 0, tip: 0 }, stab: { span: 0, at: 0.9, sweep: 0 }, blades: 4 };
  const heli: Planform = { length: 16, span: 14, width: 2.2, sweep: 0, shape: helicopter };

  it("keeps every part, the moving ones apart from the still ones", () => {
    for (const p of [long, heli, { ...heli, shape: { ...helicopter, rotors: "tandem" as const } }]) {
      const { still, moving } = planformLayers(p);
      expect(still.length + moving.reduce((n, m) => n + m.parts.length, 0)).toBe(planformParts(p).length);
    }
    expect(planformLayers(long).moving).toEqual([]);
  });

  it("turns a rotor about its mast, and two rotors each the other way", () => {
    const one = planformLayers(heli).moving;
    expect(one.map((m) => m.kind)).toEqual(["rotor"]);
    // Its blades and hub, all round the mast.
    const rotor = one[0]!;
    if (rotor.kind !== "rotor") throw new Error("not a rotor");
    for (const [x, y] of rotor.parts.flat()) expect(Math.hypot(x - rotor.at[0], y - rotor.at[1])).toBeLessThanOrEqual(heli.span / 2 + 0.01);
    for (const rotors of ["tandem", "coaxial", "intermeshing"] as const) {
      const two = planformLayers({ ...heli, shape: { ...helicopter, rotors } }).moving;
      expect(two.map((m) => (m.kind === "rotor" ? m.dir : 0)).sort()).toEqual([-1, 1]);
    }
  });

  it("sweeps a swing wing back to the span its article states, its leading edge starting at the glove's corner", async () => {
    const ref = new RefIndex(loadRefTables());
    const info = await loadTypeInfo();
    const turn = ([x, y]: Pt, [cx, cy]: Pt, deg: number): Pt => {
      const a = (deg * Math.PI) / 180;
      return [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)];
    };
    // Tupolev Tu-160: "35.6 m wings swept (65°)". Tupolev Tu-22M: "23.3 m swept (65° sweep)". The others' articles, each
    // quoted with its shape (packages/refdata/src/curated/silhouettes.ts): 79 ft, 38 ft 2.5 in, 32 ft, and in metres.
    const ft = 0.3048;
    const swung = [["T160", 35.6], ["T22M", 23.3], ["B1", 79 * ft], ["F14", 38 * ft + 2.5 * 0.0254], ["F111", 32 * ft], ["TOR", 8.6], ["MG23", 7.779], ["SU17", 10.02], ["SU24", 10.37]] as const;
    for (const [code, swept] of swung) {
      const { still, moving } = planformLayers(info.planform(code, ref)!);
      expect(moving.map((m) => m.kind)).toEqual(["swing", "swing"]);
      const parts = [...still, ...moving.flatMap((m) => (m.kind === "swing" ? m.parts.map((part) => part.map((pt) => turn(pt, m.at, m.angle))) : []))];
      const [x0, , x1] = extentOf(parts);
      expect(Math.abs((x1 - x0) / swept - 1), code).toBeLessThan(0.01);
      // The right panel's root, at the front, lands on a corner of the still parts: the glove's.
      const right = moving.find((m) => m.kind === "swing" && m.angle > 0)!;
      if (right.kind !== "swing") throw new Error("not a swing wing");
      const front = right.parts[0]!.reduce((a, b) => (b[0] < a[0] - 1e-9 || (Math.abs(b[0] - a[0]) < 1e-9 && b[1] < a[1]) ? b : a));
      const [fx, fy] = turn(front, right.at, right.angle);
      expect(Math.min(...still.flat().map(([x, y]) => Math.hypot(x - fx, y - fy))), code).toBeLessThan(0.01);
    }
  });
});
