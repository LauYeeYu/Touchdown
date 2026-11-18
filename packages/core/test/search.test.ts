import { describe, expect, it } from "vitest";
import { normaliseFlight } from "../src/index.ts";
import { flightSearch, searchFold, searchMatcher, searchText, sortedFlights } from "../src/view/index.ts";
import { newStore, ref } from "./fixtures.ts";

// Made-up flights between the fixture airports.
function views() {
  const store = newStore();
  const add = (flightNumber: string, fromRaw: string, toRaw: string, extra: Record<string, unknown> = {}) =>
    store.insert("flights", { ...normaliseFlight({ scheduledDate: "2025-04-02", flightNumber, fromRaw, toRaw, registrationRaw: "G-ABCD" }, ref), ...extra });
  add("XY1", "LHR", "JFK");
  add("XY2", "JFK", "LHR");
  add("XY3", "LHR", "BOS");
  add("XY4", "LHR", "JFK", { divertedToAirportId: "ap_kbos" });
  add("XY5", "PVG", "HND", { typeCode: "B77W" });
  return sortedFlights(store, ref);
}
const found = (q: string) => views().filter(flightSearch(q, ref)).map((v) => v.f.flightNumber).sort();

describe("flight search", () => {
  it("finds a route either way, by code, ICAO code or city", () => {
    for (const q of ["LHR-JFK", "lhr – jfk", "JFK-LHR", "LHR JFK", "EGLL-KJFK", "London - New York", "new york-london"]) {
      expect(found(q), q).toEqual(["XY1", "XY2", "XY4"]);
    }
  });

  it("finds a route one way with an arrow or 'to'", () => {
    for (const q of ["LHR > JFK", "LHR->JFK", "lhr → jfk", "LHR to JFK"]) expect(found(q), q).toEqual(["XY1", "XY4"]);
    expect(found("JFK > LHR")).toEqual(["XY2"]);
  });

  it("puts a diverted flight on the route it was booked and the one it was flown", () => {
    expect(found("LHR-BOS")).toEqual(["XY3", "XY4"]);
  });

  it("reads a side being typed as the start of a code or a city", () => {
    expect(found("LHR-J")).toEqual(["XY1", "XY2", "XY4"]);
    expect(found("shang-tok")).toEqual(["XY5"]);
  });

  it("finds a flight by its type's name as well as its code", () => {
    for (const q of ["B77W", "777", "777-300ER", "boeing 300er", "Boeing 777 300 ER"]) expect(found(q), q).toEqual(["XY5"]);
  });

  it("still finds text, a registration's dash included", () => {
    expect(found("G-ABCD")).toHaveLength(5);
    expect(found("pvg")).toEqual(["XY5"]);
    expect(found("")).toHaveLength(5);
    expect(found("LHR-PVG")).toEqual([]);
  });
});

describe("search text", () => {
  it("reads only letters and digits, in lower case, without accents", () => {
    expect(["Tu-160", "TU 160", "tu160", "Tu–160", "Tu\u2011160"].map(searchFold)).toEqual(["tu160", "tu160", "tu160", "tu160", "tu160"]);
    expect(searchFold("São Paulo")).toBe("saopaulo");
    expect(searchFold("St. John's")).toBe("stjohns");
    expect(searchFold("上海 浦东")).toBe("上海浦东");
  });

  it("finds a thing holding each word of a search, in any order, each within one of its fields", () => {
    const tu160 = searchText(["T160", "Tupolev Tu-160", "Tupolev"]);
    for (const q of ["Tu160", "tu 160", "TU-160", "160 tupolev", "t160"]) expect(searchMatcher(q)!(tu160), q).toBe(true);
    expect(searchMatcher("Tu-154")!(tu160)).toBe(false);
    // A word does not run from one field into the next: "T160" then "Tupolev" is not "160tupolev".
    expect(searchMatcher("160tupolev")!(tu160)).toBe(false);
    expect(searchMatcher("")).toBeNull();
    expect(searchMatcher(" - ")).toBeNull();
  });
});
