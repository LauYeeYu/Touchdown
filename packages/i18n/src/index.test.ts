import { afterEach, describe, expect, it } from "vitest";
import { dateLocale, dateStyles, getDateStyle, has, list, matchLocale, setDateStyle, t, tDynamic } from "./index.ts";

afterEach(() => setDateStyle("language"));

describe("the interface's language", () => {
  it("matches a browser's languages to the ones it has", () => {
    expect(matchLocale(["en-GB"])).toBe("en-GB");
    expect(matchLocale(["fr-FR", "en-US"])).toBe("en-GB");
    expect(matchLocale(["fr-FR"])).toBe("en-GB");
    expect(matchLocale([])).toBe("en-GB");
  });

  it("looks up messages, with plurals and arguments", () => {
    expect(t("common.count.flights", { count: 1 })).toBe("1\u00a0flight");
    expect(t("common.count.flights", { count: 1204 })).toBe("1,204\u00a0flights");
    expect(has("common.count.flights")).toBe(true);
    expect(has("common.nothing")).toBe(false);
    expect(tDynamic("labels.cabin.business")).toBe("Business");
  });

  it("writes lists in the language", () => {
    expect(list(["LHR", "CDG", "JFK"])).toBe("LHR, CDG and JFK");
    expect(list(["LHR", "CDG"], "disjunction")).toBe("LHR or CDG");
    expect(list(["Landing", "taxiing", "parked"], "unit")).toBe("Landing, taxiing, parked");
  });

  it("offers the language's own dates, its regional ways and ISO, and refuses others", () => {
    expect(dateStyles()).toEqual(["language", "en-US", "iso"]);
    expect(dateLocale()).toBe("en-GB");
    setDateStyle("en-US");
    expect(dateLocale()).toBe("en-US");
    setDateStyle("iso");
    expect(dateLocale()).toBe("iso");
    setDateStyle("zh-CN");
    expect(getDateStyle()).toBe("language");
  });
});
