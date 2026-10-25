import { describe, expect, it } from "vitest";
import { applyChanges, normaliseSighting, readChanges, RefIndex, resolveAirframes, Store, type AirframeFacts } from "@touchdown/core";
import { loadRefTables } from "@touchdown/refdata";
import { lookupAsChanges, type Provider } from "../src/airframes.ts";

// Made-up registrations and serial numbers; the source is a stand-in.
const facts = (registration: string, msn: string, firstFlightDate: string | null): AirframeFacts => ({
  provider: "testsite",
  url: null,
  fetchedAt: "2026-10-01T10:00Z",
  registration,
  manufacturer: "Airbus",
  msn,
  lineNumber: null,
  typeText: "Airbus A321-271NX",
  typeCode: "A21N",
  firstFlightDate,
  deliveryDate: null,
  status: null,
  registrations: [],
});

const source = (answers: Record<string, AirframeFacts[]>): Provider => ({
  id: "testsite",
  name: "Test site",
  prefer: [],
  gives: ["msn", "firstFlightDate"],
  lookup: async (reg) => (answers[reg] ? { kind: "found", candidates: answers[reg]! } : { kind: "none" }),
});

describe("looking up aircraft facts for the log", () => {
  it("leaves the log as it is and gives the answers as changes that import the same facts", async () => {
    const ref = new RefIndex(loadRefTables());
    const store = new Store({ deviceId: "test" });
    for (const [reg, seenOn] of [["N1001X", "2024-03-01"], ["N1002X", "2015-01-01"], ["N1003X", "2024-05-01"]]) {
      store.insert("sightings", normaliseSighting({ registrationRaw: reg, seenOn, typeCodeRaw: "A21N", airportRaw: "KBOS", operatorRaw: "DAL" }, ref));
    }
    resolveAirframes(store, ref);
    const before = JSON.stringify(store.all("airframes"));
    const lines: string[] = [];
    const { report, changes } = await lookupAsChanges(store, ref, {
      providers: [source({ N1001X: [facts("N1001X", "99001", "2019-05-02")], N1002X: [facts("N1002X", "99002", "2019-05-02")] })],
      log: (l) => lines.push(l),
    });
    expect(JSON.stringify(store.all("airframes"))).toBe(before);
    expect(report).toMatchObject({ looked: 3, rejected: [{ registration: "N1002X" }], notFound: ["N1003X"] });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ op: "facts", facts: { msn: "99001" } });
    expect(readChanges(JSON.parse(JSON.stringify(changes)))).toMatchObject({ changes });

    expect(applyChanges(store, ref, changes, () => true, { fileName: "airframes-made-up.json" })).toMatchObject({ applied: 1 });
    expect(store.all("airframes").find((a) => a.msn === "99001")).toMatchObject({ firstFlightDate: "2019-05-02", provisional: false });
  });
});
