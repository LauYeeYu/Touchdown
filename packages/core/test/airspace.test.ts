import { describe, expect, it } from "vitest";
import { closedShape, closuresFor, crossesShapes, insideShape, routeAround, type LonLat } from "../src/index.ts";

// A made-up closed country: a square from 10°E to 20°E, 0° to 10°N, with a hole in the middle.
const square = closedShape([
  [[10, 0], [20, 0], [20, 10], [10, 10], [10, 0]],
  [[14, 4], [16, 4], [16, 6], [14, 6], [14, 4]],
]);

describe("closed airspace", () => {
  it("is closed to the airlines it names from its date, and Ukraine's to all", () => {
    expect(closuresFor("DE", "2022-02-27").map((c) => c.country)).toEqual(["BY", "UA"]);
    expect(closuresFor("DE", "2024-06-01").map((c) => c.country).sort()).toEqual(["BY", "RU", "UA"]);
    expect(closuresFor("CN", "2024-06-01").map((c) => c.country)).toEqual(["UA"]);
    expect(closuresFor("DE", "2019-05-01")).toEqual([]);
    expect(closuresFor("DE", null)).toEqual([]);
  });

  it("tells what is inside a shape, holes excepted, and what a great circle crosses", () => {
    expect(insideShape([12, 2], square)).toBe(true);
    expect(insideShape([15, 5], square)).toBe(false);
    expect(insideShape([25, 5], square)).toBe(false);
    expect(crossesShapes([0, 5], [30, 5], [square])).toBe(true);
    expect(crossesShapes([0, 20], [30, 20], [square])).toBe(false);
  });

  it("goes round through the corridor points, or keeps the great circle when it is clear or there is no way round", () => {
    const corridor: LonLat[] = [[15, 14], [15, -30]];
    const way = routeAround([0, 5], [30, 5], [square], corridor);
    expect(way).toEqual([[0, 5], [15, 14], [30, 5]]);
    for (let i = 1; i < way.length; i++) expect(crossesShapes(way[i - 1]!, way[i]!, [square])).toBe(false);
    expect(routeAround([0, 20], [30, 20], [square], corridor)).toEqual([[0, 20], [30, 20]]);
    expect(routeAround([0, 5], [30, 5], [square], [])).toEqual([[0, 5], [30, 5]]);
    expect(routeAround([12, 2], [30, 5], [square], corridor)).toEqual([[12, 2], [30, 5]]);
  });
});
