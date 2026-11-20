import { describe, expect, it } from "vitest";
import { feetInches, typeFigures } from "./typeFigures.ts";
import { loadTypeInfo } from "./typeInfo.ts";

const figure = (key: string) => typeFigures().find((x) => x.key === key)!;
const plain = (s: string) => s.replace(/[  ]/g, " ");

describe("a type's figures in other units", () => {
  it("gives lengths in feet and inches, a weight in pounds to the precision of its tonnes, a range and a speed in both", async () => {
    const info = await loadTypeInfo();
    const b748 = info.specs("B748")!;
    expect(figure("length").others(b748).map(plain)).toEqual(["250 ft 2 in"]);
    expect(figure("height").others(b748).map(plain)).toEqual(["65 ft 7 in"]);
    expect(figure("mtow").others(b748).map(plain)).toEqual(["447,696 kg", "987,000 lb"]);
    expect(figure("range").others(b748).map(plain)).toEqual(["14,310 km", "8,892 mi"]);
    expect(figure("speed").others(b748).map(plain)).toEqual(["908 km/h", "564 mph"]);
    expect(figure("area").others(b748).map(plain)).toEqual(["5,963 sq ft"]);
    // A count and an angle have no other unit.
    expect(figure("seats").others(b748)).toEqual([]);
    expect(figure("sweep").others(b748)).toEqual([]);
    expect(plain(feetInches(20))).toBe("65 ft 7 in");
    expect(plain(feetInches(3.048))).toBe("10 ft");
  });

  it("gives a difference its sign in each, and none where it rounds to nothing", () => {
    expect(figure("length").diffOthers(5.59, 70.66).map(plain)).toEqual(["+18 ft 4 in"]);
    expect(figure("mtow").diffOthers(-50_803, 447_696).map(plain)).toEqual(["−50,803 kg", "−112,000 lb"]);
    expect(figure("length").diffOthers(0.001, 70)).toEqual([]);
  });
});
