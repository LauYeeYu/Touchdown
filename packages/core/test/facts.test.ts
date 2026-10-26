import { describe, expect, it } from "vitest";
import { applyAirframeFacts, canonicalMaker, identityKeyFor, normaliseMsn, normaliseSighting, resolveAirframes, updateAirframe, type AirframeFacts, type SightingValues } from "../src/index.ts";
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
    expect(a).toMatchObject({ msn: "99001", firstFlightDate: "2019-05-02", deliveryDate: "2019-06-01", provisional: false, identityKey: "msn:airbus-a320:99001", factsProvider: "testsite" });
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
    expect(identityKeyFor("Airbus", "038", "A20N")).toBe("msn:airbus-a320:38");
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


describe("looked-up facts as a change (touchdown airframes, docs/34)", () => {
  it("are checked again when imported, applied with their source, merged when the serial number is known, and undone", async () => {
    const { applyChanges, readChanges, undoImport } = await import("../src/index.ts");
    const { planChanges } = await import("../src/view/index.ts");
    const store = setup(sighting("N1001X", "2024-03-01"), sighting("N1002X", "2024-04-01"));
    const one = airframeOf(store, "N1001X");
    const two = airframeOf(store, "N1002X");
    applyAirframeFacts(store, ref, two, facts({ registration: "N1002X", msn: "99002", firstFlightDate: null, deliveryDate: null }));

    const changes = [
      { op: "facts" as const, id: one, facts: facts() },
      // The same serial number as N1002X's: one aircraft, merged.
      { op: "facts" as const, id: airframeOf(store, "N1001X"), facts: facts({ msn: "099002", firstFlightDate: null, deliveryDate: null, url: null }) },
    ];
    expect(readChanges(JSON.parse(JSON.stringify(changes)))).toEqual({ changes: JSON.parse(JSON.stringify(changes)) });
    expect(readChanges([{ ...changes[0], facts: { ...facts(), url: "javascript:alert(1)" } }])).toMatchObject({ error: expect.stringMatching(/malformed address/) });
    expect(readChanges([{ ...changes[0], facts: { ...facts(), firstFlightDate: "2019-13-40" } }])).toMatchObject({ error: expect.stringMatching(/firstFlightDate is not a date/) });

    const plan = planChanges(store, ref, [changes[0]!]);
    expect(plan.changes[0]).toMatchObject({ action: "Looked-up facts", status: "pending" });
    expect(plan.changes[0]!.lines.map((l) => [l.label, l.after])).toEqual(expect.arrayContaining([["Serial number", "99001"], ["First flight", "2019-05-02"], ["Source", "testsite"]]));

    const r = applyChanges(store, ref, [changes[0]!], () => true, { fileName: "airframes-1.json", now: Date.UTC(2026, 9, 1) });
    expect(r).toMatchObject({ applied: 1 });
    expect(store.get("airframes", one)).toMatchObject({ msn: "99001", provisional: false, factsProvider: "testsite" });
    expect(store.all("field_provenance").filter((p) => p.ownerId === one && p.source === "lookup").map((p) => p.detail)).toContain("testsite");
    expect(planChanges(store, ref, [changes[0]!]).changes[0]!.status).toBe("done");
    undoImport(store, ref, r.batchId);
    expect(store.get("airframes", one)).toMatchObject({ msn: null, provisional: true });
    expect(store.all("field_provenance").filter((p) => p.ownerId === one && p.source === "lookup")).toEqual([]);

    const merged = applyChanges(store, ref, [changes[1]!], () => true, { fileName: "airframes-2.json", now: Date.UTC(2026, 9, 2) });
    expect(merged.messages).toEqual([expect.stringMatching(/merged/)]);
    expect(store.get("airframes", one)).toBeNull();
    expect(store.all("sightings").every((s) => s.airframeId === two)).toBe(true);
    undoImport(store, ref, merged.batchId);
    expect(store.get("airframes", one)).not.toBeNull();
    expect(store.all("sightings").find((s) => s.registration === "N1001X")!.airframeId).toBe(one);
  });

  it("are not applied when they no longer fit the records, or would change only the user's own values", async () => {
    const { changeStatus, updateAirframe } = await import("../src/index.ts");
    const store = setup(sighting("N1001X", "2015-03-01"));
    const id = airframeOf(store, "N1001X");
    expect(changeStatus(store, ref, { op: "facts", id, facts: facts() }, () => [])).toMatchObject({ status: "missing", note: expect.stringMatching(/no longer fit your records: .*2019-05-02/) });
    updateAirframe(store, ref, id, { msn: "12345", firstFlightDate: "2010-01-01" });
    expect(changeStatus(store, ref, { op: "facts", id, facts: facts({ firstFlightDate: "2011-01-01", deliveryDate: null, status: null }) }, () => [])).toMatchObject({ status: "done" });
  });
});

describe("Airbus serial number series", () => {
  it("keeps an A321 and an A330 that share a serial number apart", () => {
    const store = setup(sighting("N1001X", "2024-03-01", "A321"), sighting("N2002X", "2024-04-01", "A333"));
    const narrow = airframeOf(store, "N1001X");
    const wide = airframeOf(store, "N2002X");
    applyAirframeFacts(store, ref, narrow, facts({ msn: "2031", typeText: "Airbus A321-231", typeCode: "A321" }));
    updateAirframe(store, ref, wide, { msn: "2031" });
    expect(store.get("airframes", narrow)).toMatchObject({ identityKey: "msn:airbus-a320:2031", provisional: false });
    expect(store.get("airframes", wide)).toMatchObject({ identityKey: "msn:airbus-a330:2031", provisional: false });
    expect(airframeOf(store, "N2002X")).toBe(wide);
    expect(store.all("airframes")).toHaveLength(2);
  });

  it("brings a key made before the series were told apart up to date", () => {
    const store = setup(sighting("N1001X", "2024-03-01", "A333"));
    const id = airframeOf(store, "N1001X");
    store.update("airframes", id, { msn: "2031", manufacturer: "Airbus", identityKey: "msn:airbus:2031", provisional: false });
    resolveAirframes(store, ref);
    expect(store.get("airframes", id)!.identityKey).toBe("msn:airbus-a330:2031");
    // Up to date: nothing changes the next time.
    let writes = 0;
    const stop = store.subscribe((c) => (writes += c.length));
    resolveAirframes(store, ref);
    stop();
    expect(writes).toBe(0);
  });
});
