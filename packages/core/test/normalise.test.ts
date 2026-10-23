import { describe, expect, it } from "vitest";
import { cityName, formatModel, guessSeatPosition, normaliseRegistration, parseFareClass, parseFlightNumber, parseModel } from "../src/index.ts";
import { ref } from "./fixtures.ts";

describe("registrations", () => {
  it("adds or keeps the country's dash", () => {
    expect(normaliseRegistration("dabcd", ref)).toMatchObject({ display: "D-ABCD", match: "DABCD", country: "DE", knownFormat: true });
    expect(normaliseRegistration("B1234", ref)).toMatchObject({ display: "B-1234", country: "CN" });
    expect(normaliseRegistration("b-30zz", ref)).toMatchObject({ display: "B-30ZZ", country: "CN" });
    expect(normaliseRegistration("B-18901", ref)).toMatchObject({ display: "B-18901", country: "TW" });
    expect(normaliseRegistration("BHNR", ref)).toMatchObject({ display: "B-HNR", country: "HK" });
    expect(normaliseRegistration(" n123ab ", ref)).toMatchObject({ display: "N123AB", country: "US" });
    expect(normaliseRegistration("JA801A", ref)).toMatchObject({ display: "JA801A", country: "JP" });
    expect(normaliseRegistration("CFIVQ", ref)).toMatchObject({ display: "C-FIVQ", country: "CA" });
  });

  it("keeps an unknown format and says so", () => {
    expect(normaliseRegistration("ZZ-TOP1", ref)).toMatchObject({ display: "ZZ-TOP1", knownFormat: false, country: null });
  });
});

describe("models", () => {
  it("parses any accepted style into the standard form", () => {
    expect(parseModel("B777-322(ER)")).toEqual({ standard: "777-322(ER)", manufacturer: "Boeing" });
    expect(parseModel("B777-322ER")).toEqual({ standard: "777-322(ER)", manufacturer: "Boeing" });
    expect(parseModel("Boeing 777-322ER")).toEqual({ standard: "777-322(ER)", manufacturer: "Boeing" });
    expect(parseModel("777-322 (ER)")).toEqual({ standard: "777-322(ER)", manufacturer: "Boeing" });
    expect(parseModel("A321-271NX")).toEqual({ standard: "A321-271NX", manufacturer: "Airbus" });
    expect(parseModel("Airbus A350-941")).toEqual({ standard: "A350-941", manufacturer: "Airbus" });
    expect(parseModel("B737-8LW")).toEqual({ standard: "737-8LW", manufacturer: "Boeing" });
    expect(parseModel("737 MAX 8")).toEqual({ standard: "737-8", manufacturer: "Boeing" });
    expect(parseModel("B777-200LR")).toEqual({ standard: "777-200LR", manufacturer: "Boeing" });
    expect(parseModel("E175LR")).toEqual({ standard: "E175LR", manufacturer: "Embraer" });
    expect(parseModel("")).toBeNull();
  });

  it("displays in either style", () => {
    expect(formatModel("777-322(ER)", "Boeing", "standard")).toBe("Boeing 777-322(ER)");
    expect(formatModel("777-322(ER)", "Boeing", "compact")).toBe("B777-322ER");
    expect(formatModel("A321-271NX", "Airbus", "compact")).toBe("A321-271NX");
    expect(formatModel("E175LR", "Embraer", "compact")).toBe("E175LR");
  });
});

describe("flight fields", () => {
  it("parses flight numbers", () => {
    expect(parseFlightNumber("dl 0049")).toMatchObject({ value: "DL49", designator: "DL" });
    expect(parseFlightNumber("B6123")).toMatchObject({ value: "B6123", designator: "B6" });
    expect(parseFlightNumber("DAL49")).toMatchObject({ designator: "DAL" });
    expect(parseFlightNumber("hello")).toBeNull();
  });

  it("splits the flight log's class column", () => {
    expect(parseFareClass("K")).toEqual({ bookingClass: "K", fareBrand: null, cabinClass: "economy" });
    expect(parseFareClass("Basic Economy")).toEqual({ bookingClass: null, fareBrand: "Basic Economy", cabinClass: "economy" });
    expect(parseFareClass("Main Cabin (L)")).toEqual({ bookingClass: "L", fareBrand: "Main Cabin", cabinClass: "economy" });
    expect(parseFareClass("X (COACH)")).toEqual({ bookingClass: "X", fareBrand: "COACH", cabinClass: "economy" });
    expect(parseFareClass("Business Saver").cabinClass).toBe("business");
  });

  it("guesses seat positions from the family layout", () => {
    expect(guessSeatPosition("12A", "A320")).toBe("window");
    expect(guessSeatPosition("12C", "A320")).toBe("aisle");
    expect(guessSeatPosition("12B", "A320")).toBe("middle");
    expect(guessSeatPosition("40K", "B777")).toBe("window");
    expect(guessSeatPosition("40E", "B777")).toBe("middle");
    expect(guessSeatPosition("40D", "A330")).toBe("aisle");
    expect(guessSeatPosition("12A", null)).toBeNull();
  });
});

describe("airport cities", () => {
  it("shows the city without what the source adds in brackets", () => {
    expect(cityName({ city: "Shanghai (Minhang)" })).toBe("Shanghai");
    expect(cityName({ city: "Kristiansand(Kjevik)" })).toBe("Kristiansand");
    expect(cityName({ city: "Hanoi  (Long Bien)" })).toBe("Hanoi");
    expect(cityName({ city: "Frankfurt am Main" })).toBe("Frankfurt am Main");
    expect(cityName({ city: null })).toBeNull();
    expect(cityName(undefined)).toBeNull();
  });
});
