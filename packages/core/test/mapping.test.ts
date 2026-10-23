import { describe, expect, it } from "vitest";
import { fieldsOf, guessMapping, headerSignature, mappingProblem, parseSource, readCsv, readMapped, unsureColumns } from "../src/index.ts";
import { ref } from "./fixtures.ts";

// Made-up rows in layouts Touchdown has no fixed reader for.
const SIGHTINGS = `Tail number,Seen on,Airport,Operator,Aircraft type,Remarks,,Gate
N1001X,2025-03-14,EGLL,BAW,A21N,Too far; nice light,G-ABCD,12
D-ABCD,2025-03-15,EDDF,DLH,B738,,D-ABCE,
G-ABCD,2025-03-15,EDDF,DLH,A21N,Retro livery,N1002X,`;

const FLIGHTS = `Date,Flight,From,To,Off time,Landed,Seat,Duration
2025-03-14,BA123,LHR,FRA,10:40,13:30,14A,01:50`;

const guessOf = (csv: string) => {
  const sheet = readCsv(csv);
  return { sheet, m: guessMapping(sheet, ref) };
};

describe("working out the columns of any sheet", () => {
  it("places columns by their headers and values", () => {
    const { m } = guessOf(SIGHTINGS);
    expect(m.kind).toBe("sightings");
    const by = Object.fromEntries(m.columns.map((c) => [c.header || `#${c.index + 1}`, [c.field, c.confidence]]));
    expect(by["Tail number"]).toEqual(["registration", "sure"]);
    expect(by["Seen on"]).toEqual(["date", "sure"]);
    expect(by["Airport"]).toEqual(["airport", "sure"]);
    expect(by["Operator"]).toEqual(["airline", "sure"]);
    expect(by["Remarks"]).toEqual(["notes", "sure"]);
  });

  it("follows the values when they contradict the header, and marks it unclear", () => {
    const { m } = guessOf(SIGHTINGS);
    const type = m.columns.find((c) => c.header === "Aircraft type")!;
    expect(type).toMatchObject({ field: "typeCode", confidence: "unsure" });
    expect(type.why).toMatch(/header says model/);
  });

  it("does not use a second column for the same field, or a field of the other kind", () => {
    const { m } = guessOf(SIGHTINGS);
    // The column without a header holds registrations, but the first column has them already.
    expect(m.columns[6]).toMatchObject({ field: "ignore", confidence: "unsure" });
    expect(m.columns[6]!.why).toMatch(/already holds registration/);
    expect(m.columns.find((c) => c.header === "Gate")).toMatchObject({ field: "ignore", confidence: "unsure" });
    expect(unsureColumns(m).map((c) => c.index)).toEqual([4, 6, 7]);
  });

  it("places a column without a header by its values", () => {
    const { m } = guessOf(`,Date\nN1001X,2025-03-14\nD-ABCD,2025-03-15`);
    expect(m.columns[0]).toMatchObject({ field: "registration", confidence: "likely" });
  });

  it("tells flights from sightings by their columns", () => {
    const { m } = guessOf(FLIGHTS);
    expect(m.kind).toBe("flights");
    expect(m.columns.map((c) => c.field)).toEqual(["date", "flightNumber", "from", "to", "takeoff", "landing", "seat", "duration"]);
  });

  it("says what a mapping lacks", () => {
    expect(mappingProblem({ kind: "sightings", fields: ["date", "airport"] })).toMatch(/registration/);
    expect(mappingProblem({ kind: "flights", fields: ["date", "registration"] })).toMatch(/flight number/);
    expect(mappingProblem({ kind: "flights", fields: ["date", "from", "to"] })).toBeNull();
    expect(mappingProblem({ kind: "sightings", fields: ["registration", "date", "registration"] })).toMatch(/Columns 1 and 3 both hold the registration/);
    expect(mappingProblem({ kind: "sightings", fields: ["registration", "notes", "notes"] })).toBeNull();
  });

  it("gives the same signature to the same headers however they are written", () => {
    expect(headerSignature(["Tail Number", "Seen on"])).toBe(headerSignature(["tail number ", "Seen-On"]));
  });
});

describe("reading rows with a mapping", () => {
  it("reads sightings, splitting free text into photo notes, a livery and notes", () => {
    const { sheet, m } = guessOf(SIGHTINGS);
    const src = readMapped(sheet, fieldsOf(m), "seen.csv", ref);
    expect(src.format).toBe("sheet");
    const [a, , c] = src.candidates;
    expect(a!.values).toMatchObject({ registration: "N1001X", seenOn: "2025-03-14", airportId: "ap_egll", operatorId: "op_baw", typeCode: "A21N", notes: "nice light" });
    expect(a!.table === "sightings" && a!.tags).toEqual(["too_far"]);
    expect(c!.values).toMatchObject({ registration: "G-ABCD", livery: "Retro livery", notes: null });
  });

  it("reads flights with their times as full date-times", () => {
    const { sheet, m } = guessOf(FLIGHTS);
    const [f] = readMapped(sheet, fieldsOf(m), "flights.csv", ref).candidates;
    expect(f!.values).toMatchObject({ scheduledDate: "2025-03-14", flightNumber: "BA123", fromAirportId: "ap_egll", toAirportId: "ap_eddf", seat: "14A", takeoffAt: "2025-03-14T10:40+00:00" });
  });

  it("reads a clock time written as an Excel day fraction", () => {
    const { sheet } = guessOf(`Date,Flight,From,To,Off time,Landed,Duration\n2025-03-14,BA123,LHR,FRA,0.4444444,0.5625,01:50`);
    const [f] = readMapped(sheet, { kind: "flights", fields: ["date", "flightNumber", "from", "to", "takeoff", "landing", "duration"] }, "f.csv", ref).candidates;
    expect((f!.values as { takeoffAt?: string }).takeoffAt).toBe("2025-03-14T10:40+00:00");
  });

  it("uses a mapping the user gave, and refuses one that cannot read rows", () => {
    const sheet = readCsv(SIGHTINGS);
    const fields = fieldsOf(guessMapping(sheet, ref)).fields;
    fields[4] = "model";
    const src = parseSource(sheet, "seen.csv", ref, { kind: "sightings", fields })!;
    expect(src.candidates[0]!.values).toMatchObject({ modelRaw: "A21N", typeCode: null });
    expect(parseSource(sheet, "seen.csv", ref, { kind: "sightings", fields: fields.map(() => "ignore") })).toBeNull();
  });
});
