import { afterEach, describe, expect, it } from "vitest";
import { dateLocale, dateStyles, getDateStyle, has, inSentence, inSourceLanguage, list, locale, matchLocale, setDateStyle, setLocale, t, tDynamic } from "./index.ts";

afterEach(async () => {
  await setLocale("en-GB");
  setDateStyle("language");
});

describe("the interface's language", () => {
  it("matches a browser's languages to the ones it has, in the browser's order", () => {
    expect(matchLocale(["en-GB"])).toBe("en-GB");
    expect(matchLocale(["fr-FR", "en-US"])).toBe("en-US");
    expect(matchLocale(["en-AU"])).toBe("en-GB");
    expect(matchLocale(["de-AT", "en-GB"])).toBe("de-DE");
    expect(matchLocale(["de"])).toBe("de-DE");
    expect(matchLocale(["zh"])).toBe("zh-CN");
    expect(matchLocale(["zh-SG"])).toBe("zh-CN");
    expect(matchLocale(["zh-Hans-HK"])).toBe("zh-CN");
    expect(matchLocale(["zh-HK"])).toBe("zh-TW");
    expect(matchLocale(["zh-Hant"])).toBe("zh-TW");
    expect(matchLocale(["zh_TW"])).toBe("zh-TW");
    expect(matchLocale(["C", "fr-FR"])).toBe("en-GB");
    expect(matchLocale([])).toBe("en-GB");
  });

  it("puts a label inside a sentence as each language writes it", async () => {
    expect(inSentence("Flight number")).toBe("flight number");
    expect(inSentence("ICAO code")).toBe("ICAO code");
    await setLocale("en-US");
    expect(inSentence("Booking reference")).toBe("booking reference");
    await setLocale("de-DE");
    expect(locale()).toBe("de-DE");
    expect(inSentence("Flugnummer")).toBe("Flugnummer");
  });

  it("writes in UK English inside inSourceLanguage, and goes back to the interface's language after", async () => {
    await setLocale("de-DE");
    setDateStyle("iso");
    const german = t("common.save");
    expect(inSourceLanguage(() => [t("common.save"), t("common.count.flights", { count: 1204 }), locale(), dateLocale()])).toEqual(["Save", "1,204\u00a0flights", "en-GB", "en-GB"]);
    expect([t("common.save"), locale(), dateLocale()]).toEqual([german, "de-DE", "iso"]);
    expect(german).not.toBe("Save");
  });

  it("shows a message a translation lacks in UK English, and en-US in its own spelling", async () => {
    await setLocale("en-US");
    expect(t("settings.display.distance.km")).toBe("Kilometers");
    expect(t("common.save")).toBe("Save");
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
