import { describe, expect, it } from "vitest";
import { loadRefTables } from "@touchdown/refdata";
import { TYPES_PAGES } from "../../../../packages/server/src/handler.ts";
import { manufacturerSlug } from "./typeEntries.ts";
import { mergeTypeData } from "./typeInfo.ts";

describe("a manufacturer's address", () => {
  it("is its own for every manufacturer, and one the server opens to anyone", () => {
    const { aircraftTypes, families } = loadRefTables();
    // Every manufacturer of a type with a page: ICAO's group codes (ZZZZ, GLID) have none.
    const manufacturers = new Set([...aircraftTypes.map((t) => t.manufacturer), ...families.map((f) => f.manufacturer)].filter(Boolean));
    const slugs = new Map<string, string>();
    for (const m of manufacturers) {
      const slug = manufacturerSlug(m);
      expect(slugs.get(slug), `${m} and ${slugs.get(slug)}`).toBeUndefined();
      slugs.set(slug, m);
      expect(TYPES_PAGES.test(`/types/manufacturers/${slug}`), m).toBe(true);
    }
    expect(manufacturerSlug("Aérospatiale-BAC")).toBe("aerospatiale-bac");
  });
});

describe("a type's figures", () => {
  const wiki = { designator: "X1", article: "Made-up airliner", revision: 1, lengthM: 40, spanM: null, heightM: null, fuselageWidthM: null, wingAreaM2: null, sweepDeg: null, mtowKg: 70000, rangeKm: null, cruiseKmh: null, cruiseMach: null, seatsTypical: 150, seatsMax: null, engines: null };
  const data = { designator: "X1", item: "Q1", revision: 2, label: "Made-up airliner", role: "airliner" as const, lengthM: 41, spanM: 35, heightM: 12, mtowKg: 72000, rangeKm: null, cruiseKmh: null, seatsMax: 180, engines: null, firstFlight: "1990", introduced: null, built: 12 };

  it("are Wikipedia's first, with what they lack from Wikidata, which is credited only when it gives one", () => {
    const both = mergeTypeData("X1", wiki, data)!;
    expect([both.lengthM, both.spanM, both.mtowKg, both.seatsMax]).toEqual([40, 35, 70000, 180]);
    expect(both.wikipedia).toEqual({ article: "Made-up airliner", revision: 1 });
    expect(both.wikidata?.figures).toBe(true);
    expect(mergeTypeData("X1", { ...wiki, spanM: 34, heightM: 11, seatsMax: 170 }, { ...data, lengthM: null })!.wikidata?.figures).toBe(false);
    expect(mergeTypeData("X1", undefined, data)!.wikipedia).toBeNull();
    expect(mergeTypeData("X1", undefined, undefined)).toBeNull();
  });
});
