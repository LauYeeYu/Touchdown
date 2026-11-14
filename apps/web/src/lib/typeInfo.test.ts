import { describe, expect, it } from "vitest";
import { RefIndex } from "@touchdown/core";
import { loadRefTables } from "@touchdown/refdata";
import { loadTypeInfo } from "./typeInfo.ts";

describe("a type's fuselage width", () => {
  const ref = new RefIndex(loadRefTables());

  it("is its family's where its own figures give none, naming the type it is from", async () => {
    const info = await loadTypeInfo();
    // The 777-200's column of the 777's comparison table has no width: the 777-300ER's specifications give it.
    expect(info.specs("B772")).toMatchObject({ fuselageWidthM: 6.2, widthFrom: "B77W" });
    expect(info.specs("B77W")).toMatchObject({ fuselageWidthM: 6.2, widthFrom: null });
    // The Dreamlifter's widened body is not the 747's.
    expect(info.specs("B744")?.fuselageWidthM).toBe(6.5);
    expect(info.specs("BLCF")?.fuselageWidthM).toBeGreaterThan(8);
    expect(info.specs("B762")?.fuselageWidthM).toBeLessThan(info.specs("A342")!.fuselageWidthM!);
  });

  it("is not shared in a family of separate models", async () => {
    const info = await loadTypeInfo();
    expect(info.specs("C510")?.fuselageWidthM).toBeNull();
    expect(info.planform("C510", ref)!.width).toBeLessThan(info.planform("C750", ref)!.width);
  });
});
