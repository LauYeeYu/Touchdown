import { describe, expect, it } from "vitest";
import { applyAirframeFacts, canonicalMaker, identityKeyFor, normaliseMsn, normaliseSighting, resolveAirframes, type AirframeFacts, type SightingValues } from "../src/index.ts";
import { newStore, ref } from "./fixtures.ts";

// Made-up registrations and serial numbers throughout.
const sighting = (registrationRaw: string, seenOn: string, typeCodeRaw = "A21N"): Partial<SightingValues> => ({ registrationRaw, seenOn, typeCodeRaw, airportRaw: "KBOS", operatorRaw: "DAL" });

function setup(...rows: Partial<SightingValues>[]) {
  const store = newStore();
  for (const r of rows) store.insert("sightings", normaliseSighting(r, ref));
  resolveAirframes(store, ref);
  return store;
}

const facts = (over: Partial<AirframeFacts> = {}): AirframeFacts => ({
  provider: "testsite",
  url: "https://example.org/airframe/1",
  fetchedAt: "2026-10-01T10:00Z",
  registration: "N1001X",
  manufacturer: "Airbus",
  msn: "99001",
  lineNumber: null,
  typeText: "Airbus A321-271NX",
  typeCode: "A21N",
  firstFlightDate: "2019-05-02",
  deliveryDate: "2019-06-01",
  status: "active",
  registrations: [],
  ...over,
});

const airframeOf = (store: ReturnType<typeof setup>, reg: string) => store.all("sightings").find((s) => s.registration === reg)!.airframeId!;

describe("applyAirframeFacts", () => {
  it("fills the facts, confirms the airframe and records where they came from", () => {
    const store = setup(sighting("N1001X", "2024-03-01"));
    const id = airframeOf(store, "N1001X");
    const out = applyAirframeFacts(store, ref, id, facts());
    expect(out.rejected).toBeNull();
    const a = store.get("airframes", id)!;
    expect(a).toMatchObject({ msn: "99001", firstFlightDate: "2019-05-02", deliveryDate: "2019-06-01", provisional: false, identityKey: "msn:airbus:99001", factsProvider: "testsite" });
    const prov = store.all("field_provenance").filter((p) => p.ownerId === id && p.source === "lookup").map((p) => p.field).sort();
    expect(prov).toEqual(["deliveryDate", "firstFlightDate", "msn", "status"]);
    expect(store.all("external_ids").find((e) => e.ownerId === id)?.value).toBe("https://example.org/airframe/1");
  });

  it("rejects a page whose aircraft first flew after the user's record", () => {
    const store = setup(sighting("N1001X", "2015-03-01"));
    const id = airframeOf(store, "N1001X");
    const out = applyAirframeFacts(store, ref, id, facts());
    expect(out.rejected).toMatch(/first flew on 2019-05-02/);
    expect(store.get("airframes", id)!.msn).toBeNull();
  });

  it("rejects a page about another type family", () => {
    const store = setup(sighting("N1001X", "2024-03-01", "B752"));
    const out = applyAirframeFacts(store, ref, airframeOf(store, "N1001X"), facts());
    expect(out.rejected).toMatch(/your records say B752/);
  });

  it("accepts a different type in the same family", () => {
    const store = setup(sighting("N1001X", "2024-03-01", "A321"));
    expect(applyAirframeFacts(store, ref, airframeOf(store, "N1001X"), facts()).rejected).toBeNull();
  });

  it("rejects when the registration was held at other times", () => {
    const store = setup(sighting("N1001X", "2024-03-01"));
    const out = applyAirframeFacts(store, ref, airframeOf(store, "N1001X"), facts({ registrations: [{ registration: "N1001X", from: "2019-06-01", to: "2022-01-31", operator: null }] }));
    expect(out.rejected).toMatch(/does not include your record of 2024-03-01/);
  });

  it("keeps a value the user typed and reports the difference", () => {
    const store = setup(sighting("N1001X", "2024-03-01"));
    const id = airframeOf(store, "N1001X");
    store.update("airframes", id, { firstFlightDate: "2019-05-03" });
    store.insert("field_provenance", { ownerTable: "airframes", ownerId: id, field: "firstFlightDate", source: "user", detail: null, recordedAt: "2026-09-01T10:00Z" });
    const out = applyAirframeFacts(store, ref, id, facts(), { overwriteImported: true });
    expect(store.get("airframes", id)!.firstFlightDate).toBe("2019-05-03");
    expect(out.differs).toEqual([{ field: "firstFlightDate", yours: "2019-05-03", lookup: "2019-05-02" }]);
  });

  it("replaces an imported value only when asked", () => {
    const store = setup(sighting("N1001X", "2024-03-01"));
    const id = airframeOf(store, "N1001X");
    store.update("airframes", id, { firstFlightDate: "2019-05-03" });
    store.insert("field_provenance", { ownerTable: "airframes", ownerId: id, field: "firstFlightDate", source: "user", detail: "sheet.csv", recordedAt: "2026-09-01T10:00Z" });
    expect(applyAirframeFacts(store, ref, id, facts()).differs).toHaveLength(1);
    expect(store.get("airframes", id)!.firstFlightDate).toBe("2019-05-03");
    applyAirframeFacts(store, ref, id, facts(), { overwriteImported: true });
    expect(store.get("airframes", id)!.firstFlightDate).toBe("2019-05-02");
  });

  it("merges two entries that turn out to be one aircraft under two registrations", () => {
    const store = setup(sighting("N1001X", "2021-03-01"), sighting("N2002X", "2024-08-01"));
    const first = airframeOf(store, "N1001X");
    const second = airframeOf(store, "N2002X");
    expect(first).not.toBe(second);
    applyAirframeFacts(store, ref, first, facts());
    const out = applyAirframeFacts(store, ref, second, facts({ registration: "N2002X" }));
    expect(out.mergedInto).toBe(first);
    resolveAirframes(store, ref);
    expect(airframeOf(store, "N1001X")).toBe(first);
    expect(airframeOf(store, "N2002X")).toBe(first);
    expect(store.all("airframes")).toHaveLength(1);
    expect(store.all("registration_periods").filter((p) => p.airframeId === first).map((p) => p.registration).sort()).toEqual(["N1001X", "N2002X"]);
  });

  it("compares serial numbers without padding", () => {
    expect(normaliseMsn(" 038 ")).toBe("38");
    expect(normaliseMsn("0")).toBe("0");
    expect(normaliseMsn("rk-354")).toBe("RK-354");
    expect(identityKeyFor("Airbus", "038")).toBe("msn:airbus:38");
    const store = setup(sighting("N1001X", "2024-03-01"));
    const id = airframeOf(store, "N1001X");
    applyAirframeFacts(store, ref, id, facts({ msn: "099001" }));
    expect(store.get("airframes", id)!.msn).toBe("99001");
  });

  it("rejects an aircraft built after the user's record", () => {
    const store = setup(sighting("N1001X", "2018-03-01"));
    const id = airframeOf(store, "N1001X");
    expect(applyAirframeFacts(store, ref, id, facts({ firstFlightDate: null, notBefore: "2019-01-01", notBeforeLabel: "was built in 2019" })).rejected).toMatch(/was built in 2019, after your record of 2018-03-01/);
    expect(applyAirframeFacts(store, ref, id, facts({ firstFlightDate: null, notBefore: "2019-01-01" })).rejected).toMatch(/dates from 2019-01-01/);
  });

  it("writes makers as the reference data does", () => {
    expect(canonicalMaker("Airbus SAS", ref)).toBe("Airbus");
    expect(canonicalMaker("AIRBUS", ref)).toBe("Airbus");
    expect(canonicalMaker("Boeing Commercial Airplanes", ref)).toBe("Boeing");
    expect(canonicalMaker("Unknown Works Ltd", ref)).toBe("Unknown Works Ltd");
  });
});

