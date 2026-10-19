import { describe, expect, it } from "vitest";
import { parsePageDate, parsePastedFacts } from "../src/index.ts";

// Made-up text in the shapes these pages copy as.
describe("parsePastedFacts", () => {
  it("reads label and value pairs copied from a table (tab separated)", () => {
    const text = `Example Air N1001X (Airbus A321 - MSN 99001) | Airfleets aviation
Serial number\t99001
Type\t321-271NX
First flight date\t02/05/2019
Test registration\tD-AVZZ
Registration\tDelivery date\tAirline\tRemark
N1001X\t01/06/2019\tExample Air\t`;
    expect(parsePastedFacts(text)).toMatchObject({ msn: "99001", typeText: "321-271NX", firstFlightDate: "2019-05-02", site: "airfleets.net" });
  });

  it("reads values on the line after their label", () => {
    const text = `AIRCRAFT\nAirbus A321-271NX\nSERIAL NUMBER (MSN)\n099001\nAGE (May 2019)\n7 years\nflightradar24`;
    expect(parsePastedFacts(text)).toMatchObject({ msn: "099001", typeText: "Airbus A321-271NX", firstFlightDate: null, site: "Flightradar24" });
  });

  it("reads colon pairs and other date forms", () => {
    const text = `MSN: 99001\nLine number: 7001\nFirst flight: 2 May 2019\nDelivered: Jun 1, 2019`;
    expect(parsePastedFacts(text)).toMatchObject({ msn: "99001", lineNumber: "7001", firstFlightDate: "2019-05-02", deliveryDate: "2019-06-01" });
  });

  it("keeps a month-only first flight apart from a date", () => {
    expect(parsePastedFacts("First flight\t05/2019")).toMatchObject({ firstFlightDate: null, firstFlightMonth: "2019-05" });
  });
});

describe("parsePageDate", () => {
  it("reads slashed dates day first unless that is impossible", () => {
    expect(parsePageDate("06/10/2009").date).toBe("2009-10-06");
    expect(parsePageDate("10/26/2009").date).toBe("2009-10-26");
    expect(parsePageDate("31/02/2009").date).toBeNull();
    expect(parsePageDate("17-Sep-2011").date).toBe("2011-09-17");
    expect(parsePageDate("September 17, 2011").date).toBe("2011-09-17");
  });
});
