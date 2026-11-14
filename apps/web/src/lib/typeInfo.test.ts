import { describe, expect, it } from "vitest";
import { RefIndex } from "@touchdown/core";
import { loadRefTables } from "@touchdown/refdata";
import { loadTypeInfo } from "./typeInfo.ts";

describe("a type's fuselage width", () => {
  const ref = new RefIndex(loadRefTables());

  it("is its family's where its own figures give none, naming the type it is from", async () => {
    const info = await loadTypeInfo();
    // The 777-200's column of the 777's comparison table has no width: the 777-300ER's specifications give it.
    expect(info.specs("B772")).toMatchObject({ fuselageWidthM: 6.2, widthFrom: "B77W", widthArticle: null });
    expect(info.specs("B77W")).toMatchObject({ fuselageWidthM: 6.2, widthFrom: null });
    // The Dreamlifter's widened body is not the 747's.
    expect(info.specs("B744")?.fuselageWidthM).toBe(6.5);
    expect(info.specs("BLCF")?.fuselageWidthM).toBeGreaterThan(8);
    expect(info.specs("B762")?.fuselageWidthM).toBeLessThan(info.specs("A342")!.fuselageWidthM!);
  });

  it("is the comparison table's for a family none of whose types give one", async () => {
    const info = await loadTypeInfo();
    expect(info.specs("A388")).toMatchObject({ fuselageWidthM: 7.14, widthFrom: null, widthArticle: { title: "Wide-body aircraft" } });
    expect(info.specs("MD82")?.fuselageWidthM).toBeLessThan(info.specs("B738")!.fuselageWidthM!);
  });

  it("is not shared in a family of separate models", async () => {
    const info = await loadTypeInfo();
    expect(info.specs("C510")?.fuselageWidthM).toBeNull();
    expect(info.planform("C510", ref)!.width).toBeLessThan(info.planform("C750", ref)!.width);
  });

  it("is drawn the same for a family's types, a stretch as wide as the type it stretches", async () => {
    const info = await loadTypeInfo();
    expect(info.planform("B772", ref)!.width).toBe(info.planform("B779", ref)!.width);
    // The 787-3 was never built and has no figures: it is drawn with the family's width all the same.
    expect(info.planform("B783", ref)!.width).toBe(5.77);
    // No type of the Gulfstream G400/G500/G600 gives one: the drawing works one out for the family.
    expect(info.planform("GA4C", ref)!.width).toBe(info.planform("GA6C", ref)!.width);
  });
});
