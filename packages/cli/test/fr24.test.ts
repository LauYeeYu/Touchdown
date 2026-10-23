import { describe, expect, it } from "vitest";
import { RefIndex } from "@touchdown/core";
import { refTables } from "../../core/test/fixtures.ts";
import { fr24Evidence, fr24Facts, monthOf } from "../src/providers/fr24.ts";

const ref = new RefIndex(refTables);

// The details block as read from an FR24 aircraft page; values made up.
const page = {
  title: "N1001X - Airbus A321-271NX - Delta Air Lines - Flightradar24",
  fetchedAt: "2026-10-01T10:00:00.000Z",
  rows: [
    ["AIRCRAFT", "Airbus A321-271NX"],
    ["TYPE CODE", "A21N"],
    ["MODE S", "A00001"],
    ["SERIAL NUMBER (MSN)", "099001"],
    ["AGE (Mar 2019)", "7 years"],
  ] as [string, string][],
};

describe("Flightradar24 aircraft page", () => {
  it("reads the month beside the age", () => {
    expect(monthOf("AGE (Mar 2019)")).toBe("2019-03");
    expect(monthOf("AGE")).toBeNull();
  });

  it("gives the serial number and uses the month only as a loose check, a year early", () => {
    const f = fr24Facts("N1001X", page, ref, "https://www.flightradar24.com/data/aircraft/n1001x")!;
    expect(f).toMatchObject({ msn: "099001", typeCode: "A21N", manufacturer: "Airbus", firstFlightDate: null, notBefore: "2018-03-01" });
  });

  it("finds nothing on a page without a serial number", () => {
    expect(fr24Facts("N1001X", { ...page, rows: [["AIRCRAFT", ""]] }, ref, "x")).toBeNull();
  });

  it("treats a dash as unknown", () => {
    const f = fr24Facts("N1001X", { ...page, rows: [["AIRCRAFT", "-"], ["TYPE CODE", "-"], ["SERIAL NUMBER (MSN)", "099001"]] }, ref, "x")!;
    expect(f).toMatchObject({ msn: "099001", manufacturer: null, typeText: null, typeCode: null });
  });

  it("gives the airline the aircraft flies for, and the operator in the note when it is another", () => {
    const withAirline = {
      ...page,
      rows: [
        ["AIRCRAFT", "Airbus A321-271NX"],
        ["AIRLINE", "British Airways"],
        ["OPERATOR", "Example Cityflyer"],
        ["TYPE CODE", "A21N"],
        ["Code", "BA / BAW"],
        ["Code", "XC / XCF"],
        ["SERIAL NUMBER (MSN)", "099001"],
        ["AGE (Mar 2019)", "7 years"],
      ] as [string, string][],
    };
    const e = fr24Evidence("G-ABCD", withAirline, ref, "https://www.flightradar24.com/data/aircraft/g-abcd")!;
    expect(e).toMatchObject({ source: "fr24", typeCode: "A21N", model: "A321-271NX", operator: "BAW", operatorName: "British Airways", asOf: "2026-10-01", note: "operated by Example Cityflyer (XC / XCF)" });
    expect(e.facts?.msn).toBe("099001");
  });
});
