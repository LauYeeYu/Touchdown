import { describe, expect, it } from "vitest";
import { formatNodes, messageArgs, MessageSyntaxError, parseMessage } from "./message.ts";

function fmt(source: string, values: Record<string, unknown> = {}, locale = "en-GB"): string {
  return formatNodes<never>(parseMessage(source), { locale, values, missing: () => {} }).join("");
}

describe("messages", () => {
  it("puts arguments in as given, and formats numbers asked for", () => {
    expect(fmt("Hello {name}.", { name: "Ada" })).toBe("Hello Ada.");
    expect(fmt("{year}", { year: 2025 })).toBe("2025");
    expect(fmt("{n, number} km", { n: 12345 })).toBe("12,345 km");
    expect(fmt("{n, number}", { n: 12345 }, "de-DE")).toBe("12.345");
  });

  it("chooses plural forms, exact cases first", () => {
    const m = "{count, plural, =0 {No flights} one {# flight} other {# flights}}";
    expect(fmt(m, { count: 0 })).toBe("No flights");
    expect(fmt(m, { count: 1 })).toBe("1 flight");
    expect(fmt(m, { count: 1200 })).toBe("1,200 flights");
    expect(fmt("{n, plural, one {# leg} few {# legs (few)} other {# legs}}", { n: 3 }, "pl")).toBe("3 legs (few)");
    expect(fmt("{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}", { n: 22 })).toBe("22nd");
  });

  it("chooses by value", () => {
    const m = "{kind, select, flight {A flight} sighting {A sighting} other {A record}}";
    expect(fmt(m, { kind: "flight" })).toBe("A flight");
    expect(fmt(m, { kind: "aircraft" })).toBe("A record");
  });

  it("nests plurals in selects and keeps # to its own plural", () => {
    const m = "{who, select, you {You flew {n, plural, one {# time} other {# times}}} other {{name} flew # times}}";
    expect(fmt(m, { who: "you", n: 2 })).toBe("You flew 2 times");
    expect(fmt(m, { who: "x", name: "Ada", n: 2 })).toBe("Ada flew # times");
  });

  it("reads apostrophes as ICU does", () => {
    expect(fmt("Touchdown's log")).toBe("Touchdown's log");
    expect(fmt("It''s")).toBe("It's");
    expect(fmt("'{name}' is literal")).toBe("{name} is literal");
    expect(fmt("{n, plural, other {'#' {n}}}", { n: 3 })).toBe("# 3");
  });

  it("gives tags to the caller, and their text without one", () => {
    const nodes = parseMessage("You selected <b>{mode}</b> mode.");
    const parts = formatNodes<{ b: (string | object)[] }>(nodes, { locale: "en-GB", values: { mode: "Standard" }, tags: { b: (p) => ({ b: p }) }, missing: () => {} });
    expect(parts).toEqual(["You selected ", { b: ["Standard"] }, " mode."]);
    expect(fmt("You selected <b>{mode}</b> mode.", { mode: "Standard" })).toBe("You selected Standard mode.");
    expect(fmt("a < b and 1<2")).toBe("a < b and 1<2");
  });

  it("keeps rich values as parts", () => {
    const el = { element: true };
    const parts = formatNodes<object>(parseMessage("{n, plural, one {# flight} other {# flights}} from {place}"), { locale: "en-GB", values: { n: 2, place: el }, missing: () => {} });
    expect(parts).toEqual(["2 flights from ", el]);
  });

  it("reports what a message takes", () => {
    const args = messageArgs(parseMessage("{who, select, you {<b>{n, plural, other {#}}</b>} other {{name} {n}}}"));
    expect(Object.fromEntries(args)).toEqual({ who: "choice", "<b>": "tag", n: "number", name: "text" });
  });

  it("refuses broken messages", () => {
    for (const bad of ["{name", "a }", "{n, plural, one {x}}", "{n, date}", "<b>x", "x</b>", "{n, plural, one {a} one {b} other {c}}", "'{"]) {
      expect(() => parseMessage(bad), bad).toThrow(MessageSyntaxError);
    }
  });
});
