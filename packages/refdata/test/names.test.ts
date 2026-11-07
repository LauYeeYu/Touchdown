import { describe, expect, it } from "vitest";
import { namesIn, sameAirline } from "../scripts/names.ts";
import { loadRefNames } from "../src/names.ts";

describe("names in other languages", () => {
  it("takes each language's own label, converts Simplified to Taiwan's Traditional where there is none, and keeps German that differs", () => {
    expect(namesIn({ "zh-cn": "达美航空", "zh-tw": "達美航空", de: "Delta Air Lines", en: "Delta Air Lines" }, "Delta Air Lines")).toEqual({ "zh-CN": "达美航空", "zh-TW": "達美航空" });
    expect(namesIn({ zh: "波士顿洛根国际机场", de: "Flughafen Boston-Logan" }, "Logan International")).toEqual({ "zh-CN": "波士顿洛根国际机场", "zh-TW": "波士頓洛根國際機場", "de-DE": "Flughafen Boston-Logan" });
    // A "Chinese" label written in Latin letters is no Chinese name.
    expect(namesIn({ zh: "Utirik Airport" }, "Utirik Airport")).toEqual({});
  });

  it("matches an airline by its name, since an ICAO code passes from one airline to another", () => {
    expect(sameAirline("Delta Air Lines", "Delta Air Lines, Inc.")).toBe(true);
    expect(sameAirline("Lufthansa", "Deutsche Lufthansa AG")).toBe(true);
    expect(sameAirline("Avicon Aviation Consultants", "American Airlines")).toBe(false);
  });

  it("loads a language's names, and none for English", async () => {
    expect(await loadRefNames("en-GB")).toBeNull();
    const zh = await loadRefNames("zh-CN");
    expect(Object.keys(zh!.airports).length).toBeGreaterThan(1000);
    expect(Object.keys(zh!.operators).length).toBeGreaterThan(500);
  });
});
