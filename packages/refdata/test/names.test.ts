import { describe, expect, it } from "vitest";
import { best, namesIn, sameAirline } from "../scripts/names.ts";
import { loadRefNames } from "../src/names.ts";

describe("names in other languages", () => {
  it("takes each language's own label, converts Simplified to Taiwan's Traditional where there is none, and keeps German that differs", () => {
    expect(namesIn({ "zh-cn": "达美航空", "zh-tw": "達美航空", de: "Delta Air Lines", en: "Delta Air Lines" }, "Delta Air Lines")).toEqual({ "zh-CN": "达美航空", "zh-TW": "達美航空" });
    expect(namesIn({ zh: "波士顿洛根国际机场", de: "Flughafen Boston-Logan" }, "Logan International")).toEqual({ "zh-CN": "波士顿洛根国际机场", "zh-TW": "波士頓洛根國際機場", "de-DE": "Flughafen Boston-Logan" });
    // A "Chinese" label written in Latin letters is no Chinese name.
    expect(namesIn({ zh: "Utirik Airport" }, "Utirik Airport")).toEqual({});
  });

  it("passes over an airport's label that is only its place's name, or does not fit", () => {
    const place = { zh: "港湾", "zh-hant": "港灣", de: "Harbourton" };
    const labels = { "zh-cn": "港湾", "zh-hans": "港湾海军基地", zh: "港灣國際機場", de: "Harbourton" };
    expect(namesIn(labels, "Harbourton International Airport", place)).toEqual({ "zh-CN": "港湾海军基地", "zh-TW": "港灣海軍基地" });
    expect(namesIn(labels, "Harbourton International Airport", place, [/机场/, /基地/])).toEqual({ "zh-CN": "港湾国际机场", "zh-TW": "港灣國際機場" });
    expect(namesIn({ zh: "港湾（HBT）" }, "Harbourton Airport", {}, [/机场/])).toEqual({});
  });

  it("matches an airline by its name, since an ICAO code passes from one airline to another", () => {
    expect(sameAirline("Delta Air Lines", "Delta Air Lines, Inc.")).toBe(true);
    expect(sameAirline("Lufthansa", "Deutsche Lufthansa AG")).toBe(true);
    expect(sameAirline("Avicon Aviation Consultants", "American Airlines")).toBe(false);
  });

  it("chooses the same item of several with a code every time: the one named most like ours", () => {
    const labels = new Map([
      ["http://www.wikidata.org/entity/Q20", { en: "Harbourton Air Base", zh: "港湾空军基地" }],
      ["http://www.wikidata.org/entity/Q30", { en: "Harbourton International Airport", zh: "港湾国际机场" }],
      ["http://www.wikidata.org/entity/Q40", { mul: "Harbourton Airport" }],
      ["http://www.wikidata.org/entity/Q50", { en: "Harbourton", zh: "港湾" }],
      ["http://www.wikidata.org/entity/Q60", { en: "Harbourton District", zh: "港湾区" }],
    ]);
    const airports = new Set(["airport", "international", "air", "base"]);
    const items = ["http://www.wikidata.org/entity/Q20", "http://www.wikidata.org/entity/Q30", "http://www.wikidata.org/entity/Q40"];
    expect(best(items, labels, "Harbourton International Airport", airports)).toBe(items[1]);
    expect(best([...items].reverse(), labels, "Harbourton International Airport", airports)).toBe(items[1]);
    // An English name only in the label for every language counts as English.
    expect(best(items, labels, "Harbourton Airport", airports)).toBe(items[2]);
    expect(best(["http://www.wikidata.org/entity/Q60", "http://www.wikidata.org/entity/Q50"], labels, "Harbourton", new Set(["district"]))).toBe("http://www.wikidata.org/entity/Q50");
    expect(best([], labels, "Harbourton", airports)).toBeUndefined();
    // Of those named alike, the one wanted, here one with a Chinese name.
    const chinese = (item: string) => (labels.get(item) && "zh" in labels.get(item)! ? 1 : 0);
    expect(best(items, labels, "Harbourton Airport", airports, chinese)).toBe(items[1]);
  });

  it("loads a language's names, and none for English", async () => {
    expect(await loadRefNames("en-GB")).toBeNull();
    const zh = await loadRefNames("zh-CN");
    expect(Object.keys(zh!.airports).length).toBeGreaterThan(1000);
    expect(Object.keys(zh!.operators).length).toBeGreaterThan(500);
  });
});
