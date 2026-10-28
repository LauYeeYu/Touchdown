import { describe, expect, it } from "vitest";
import {
  checkAgentAnswer,
  chooseValues,
  commitImport,
  describeDisagreement,
  logEvidence,
  logLivery,
  matchCandidates,
  modelFromSource,
  modelsAgree,
  parseSpotLine,
  readInbox,
  useOrAsk,
  withSettings,
  type CheckRecord,
  type Evidence,
  type InboxFile,
} from "../src/index.ts";
import { newStore, ref } from "./fixtures.ts";

// Every registration, date and value here is made up.
const TODAY = "2026-10-20";

const ev = (source: Evidence["source"], v: Partial<Evidence>): Evidence => ({ source, typeCode: null, model: null, operator: null, operatorName: null, asOf: null, note: null, facts: null, url: null, ...v });

describe("reading a typed line", () => {
  it("reads a registration and a phase", () => {
    expect(parseSpotLine("G-ABCD landing", ref, TODAY)).toMatchObject({ typed: { registration: "G-ABCD", phase: "landing" }, text: "", setting: null, problems: [] });
  });

  it("reads place, date, airline, type and keeps the rest as text", () => {
    const l = parseSpotLine('D-ABCD at FRA on 15/03/2025 DLH A21N "Retro livery" nice light', ref, TODAY);
    expect(l.typed).toEqual({ registration: "D-ABCD", airport: "EDDF", date: "2025-03-15", operator: "DLH", typeCode: "A21N" });
    expect(l.text).toBe("Retro livery · nice light");
  });

  it("takes an IATA airline code only in capitals, a model, and two-word phases", () => {
    expect(parseSpotLine("N1001X BA 737-8H4 taking off", ref, TODAY).typed).toEqual({ registration: "N1001X", operator: "BAW", model: "737-8H4", phase: "taking_off" });
    expect(parseSpotLine("N1001X ba", ref, TODAY).text).toBe("ba");
  });

  it("reads a registration without its dash only in capitals, so words stay words", () => {
    expect(parseSpotLine("DABCD", ref, TODAY).typed.registration).toBe("D-ABCD");
    expect(parseSpotLine("g-abcd dream great", ref, TODAY)).toMatchObject({ typed: { registration: "G-ABCD" }, text: "dream great" });
  });

  it("does not read a bare number as a date", () => {
    expect(parseSpotLine("G-ABCD 232", ref, TODAY)).toMatchObject({ typed: { registration: "G-ABCD" }, text: "232" });
  });

  it("treats a line with only a place, date or phase as a setting for the lines after it", () => {
    expect(parseSpotLine("at EGLL", ref, TODAY).setting).toEqual({ airport: "EGLL" });
    expect(parseSpotLine("on yesterday landing", ref, TODAY).setting).toEqual({ date: "2026-10-19", phase: "landing" });
    expect(parseSpotLine("no phase", ref, TODAY).setting).toEqual({ phase: null });
    expect(withSettings({ registration: "G-ABCD" }, { airport: "EGLL", date: TODAY, phase: "landing" })).toMatchObject({ airport: "EGLL", date: TODAY, phase: "landing" });
    expect(withSettings({ registration: "G-ABCD", airport: "EDDF" }, { airport: "EGLL", phase: null })).toMatchObject({ airport: "EDDF", phase: undefined });
  });

  it("reports what it cannot use", () => {
    expect(parseSpotLine("G-ABCD at XQXQ", ref, TODAY).problems).toEqual(["No airport has the code XQXQ."]);
    expect(parseSpotLine("hello there", ref, TODAY).problems).toEqual(["No registration on this line."]);
    expect(parseSpotLine("G-ABCD D-ABCD", ref, TODAY).problems[0]).toMatch(/Two values for the registration/);
    expect(parseSpotLine("G-ABCD on 2027-01-01", ref, TODAY).problems).toEqual(["2027-01-01 is in the future."]);
  });
});

describe("models as lookups write them", () => {
  it("turns them into the standard form and keeps only a full model of the type", () => {
    expect(modelFromSource("A321 271NX", "A21N", ref)).toBe("A321-271NX");
    expect(modelFromSource("Airbus A321-271NX", "A21N", ref)).toBe("A321-271NX");
    expect(modelFromSource("Boeing 787-8 Dreamliner", "B788", ref)).toBe("787-8");
    expect(modelFromSource("A321 211", "A21N", ref)).toBeNull();
    // OpenSky's notations for winglets and sharklets.
    expect(modelFromSource("737NG 838/W", "B738", ref)).toBe("737-838");
    expect(modelFromSource("737NG 800/W", "B738", ref)).toBe("737-800");
    expect(modelFromSource("737NG 7BX/W", "B737", ref)).toBe("737-7BX");
    expect(modelFromSource("A320 214SL", "A320", ref)).toBe("A320-214");
    expect(modelFromSource("Boeing 737", null, ref)).toBeNull();
  });
});

describe("choosing the values", () => {
  it("keeps what the user typed and lists a source that says otherwise", () => {
    const c = chooseValues({ registration: "G-ABCD", typeCode: "B738" }, [ev("adsbdb", { typeCode: "A21N" })], ref, TODAY);
    expect(c.values.typeCode).toBe("B738");
    expect(c.sources.typeCode).toBe("you");
    // A 737 against an A321neo: another family, so probably another aircraft (or a typo).
    expect(c.disagreements).toEqual([{ field: "typeCode", kept: "B738", keptFrom: "you", others: [{ value: "A21N", source: "adsbdb" }], otherAircraft: true }]);
  });

  it("fills the type and model from the source kept most up to date", () => {
    const c = chooseValues({ registration: "G-ABCD" }, [ev("opensky", { typeCode: "A321", model: "A321-211" }), ev("adsbdb", { typeCode: "A21N", model: "A321-271NX" })], ref, TODAY);
    expect(c.values).toMatchObject({ typeCode: "A21N", model: "A321-271NX" });
    expect(c.sources).toMatchObject({ typeCode: "adsbdb", model: "adsbdb" });
    // The OpenSky model is not a model of an A21N, so it is not counted against the choice.
    expect(c.disagreements.map((d) => d.field)).toEqual(["typeCode"]);
  });

  it("takes the airline from the source nearest the sighting's date", () => {
    const sources = [ev("your_log", { operator: "BAW", asOf: "2019-05-20" }), ev("fr24", { operator: "DLH", asOf: "2026-10-01" })];
    expect(chooseValues({ registration: "G-ABCD", date: "2019-06-01" }, sources, ref, TODAY).values.operator).toBe("BAW");
    expect(chooseValues({ registration: "G-ABCD", date: TODAY }, sources, ref, TODAY).values.operator).toBe("DLH");
  });

  it("works out the type from a typed model", () => {
    const c = chooseValues({ registration: "N1001X", model: "737-8H4" }, [], ref, TODAY);
    expect(c.values.typeCode).toBe("B738");
    expect(c.sources.typeCode).toBe("derived");
  });

  it("takes the serial number from a source that has one", () => {
    const facts = { provider: "opensky", url: null, fetchedAt: "2025-08-01T00:00Z", registration: "G-ABCD", manufacturer: "Airbus", msn: "9001", lineNumber: null, typeText: null, typeCode: "A21N", firstFlightDate: null, deliveryDate: null, status: null, registrations: [] };
    expect(chooseValues({ registration: "G-ABCD" }, [ev("adsbdb", { typeCode: "A21N" }), ev("opensky", { typeCode: "A21N", facts })], ref, TODAY).facts?.msn).toBe("9001");
  });
});

describe("comparing what the user typed with the sources", () => {
  it("takes a series, a certificate name or a dropped suffix as the same model", () => {
    expect(modelsAgree("777-31H(ER)", "777-300(ER)")).toBe(true);
    expect(modelsAgree("717-22A", "717-200")).toBe(true);
    expect(modelsAgree("767-332(ER)", "767-332")).toBe(true);
    expect(modelsAgree("767-332(ER)(BDSF)", "767-332")).toBe(true);
    expect(modelsAgree("747-467F(ER)", "747-467ERF")).toBe(true);
    expect(modelsAgree("A220-300", "BD-500-1A11")).toBe(true);
    expect(modelsAgree("A330-343", "A330-343E")).toBe(true);
    expect(modelsAgree("A320-214", "A320-232")).toBe(false);
    expect(modelsAgree("777-200", "777-31H")).toBe(false);
  });

  it("does not dispute a typed airline with the company OpenSky or adsbdb say operates the aircraft", () => {
    const c = chooseValues({ registration: "N1001X", operator: "DAL" }, [ev("opensky", { operator: "UAL" }), ev("fr24", { operator: "AAL" })], ref, TODAY);
    expect(c.disagreements).toEqual([{ field: "operator", kept: "DAL", keptFrom: "you", others: [{ value: "AAL", source: "fr24" }] }]);
    // An empty airline is still filled from them.
    expect(chooseValues({ registration: "N1001X" }, [ev("opensky", { operator: "UAL" })], ref, TODAY).values.operator).toBe("UAL");
  });

  it("treats a source with another family of type as another aircraft, and does not use the rest of what it says", () => {
    const c = chooseValues({ registration: "N1001X", typeCode: "A21N" }, [ev("opensky", { typeCode: "B738", model: "737-8H4", operator: "UAL" }), ev("adsbdb", { typeCode: "A21N", model: "A321-271NX" })], ref, TODAY);
    expect(c.values).toMatchObject({ typeCode: "A21N", model: "A321-271NX" });
    expect(c.values.operator).toBeUndefined();
    expect(c.disagreements[0]).toMatchObject({ field: "typeCode", otherAircraft: true });
    expect(describeDisagreement(c.disagreements[0]!)).toMatch(/registration may have been reused/);
  });
});

describe("the user's own log as a source", () => {
  it("gives the record nearest the date and how often the aircraft was seen", () => {
    const store = newStore();
    store.insert("sightings", { registration: "G-ABCD", seenOn: "2019-06-01", typeCode: "A21N", operatorId: "op_baw" });
    store.insert("sightings", { registration: "G-ABCD", seenOn: "2024-01-10", typeCode: "A21N", operatorId: "op_dlh" });
    const e = logEvidence(store, ref, "GABCD", "2019-07-01")!;
    expect(e).toMatchObject({ source: "your_log", typeCode: "A21N", operator: "BAW", asOf: "2019-06-01", note: "seen 2 times (2019-06-01 to 2024-01-10)" });
    expect(logEvidence(store, ref, "D-ABCD", "2019-07-01")).toBeNull();
  });

  it("leaves out the sighting being checked, so a row already in the log does not vouch for itself", () => {
    const store = newStore();
    store.insert("sightings", { registration: "G-ABCD", seenOn: "2019-06-01", airportId: "ap_egll", typeCode: "A21N", operatorId: "op_baw" });
    expect(logEvidence(store, ref, "G-ABCD", "2019-06-01", { date: "2019-06-01", airport: "EGLL" })).toBeNull();
    expect(logEvidence(store, ref, "G-ABCD", "2019-06-01", { date: "2019-06-01", airport: "EDDF" })?.typeCode).toBe("A21N");
  });

  it("finds the special livery recorded nearest the date, however old, to ask about", () => {
    const store = newStore();
    store.insert("sightings", { registration: "G-ABCD", seenOn: "2019-06-01", airportId: "ap_egll", specialLivery: "Retro Livery" });
    store.insert("sightings", { registration: "G-ABCD", seenOn: "2024-01-10" });
    expect(logLivery(store, ref, "G-ABCD", "2025-07-01")).toEqual({ name: "Retro Livery", on: "2019-06-01" });
    // The sighting being checked does not count.
    expect(logLivery(store, ref, "G-ABCD", "2019-06-01", { date: "2019-06-01", airport: "EGLL" })).toBeNull();
    expect(logLivery(store, ref, "D-ABCD", "2025-07-01")).toBeNull();
  });
});

describe("what the agent suggests", () => {
  const choice = chooseValues({ registration: "G-ABCD", phase: "landing", notes: "Retro livery" }, [ev("adsbdb", { typeCode: "A21N", operator: "BAW" })], ref, TODAY);
  const evidence = [ev("adsbdb", { typeCode: "A21N", operator: "BAW" }), ev("opensky", { operator: "DLH" })];
  const s = (field: string, suggested: string, basis: string, confidence = "high") => ({ field, suggested, basis, confidence }) as never;

  it("uses what the sources back and what sorts the user's words; asks about the rest", () => {
    expect(useOrAsk(s("operator", "DLH", "lookup_data"), choice, evidence, ref)).toBe("use");
    expect(useOrAsk(s("operator", "UAL", "lookup_data"), choice, evidence, ref)).toBe("ask");
    expect(useOrAsk(s("specialLivery", "Retro", "typed"), choice, evidence, ref)).toBe("use");
    expect(useOrAsk(s("notes", "", "typed"), choice, evidence, ref)).toBe("use");
    expect(useOrAsk(s("model", "A321-271NX", "model_knowledge"), choice, evidence, ref)).toBe("ask");
    expect(useOrAsk(s("model", "A321-271NX", "reference_data", "medium"), choice, evidence, ref)).toBe("ask");
  });

  it("asks before changing anything the user typed", () => {
    expect(useOrAsk(s("phase", "taking_off", "typed"), choice, evidence, ref)).toBe("ask");
    expect(useOrAsk(s("phase", "taking_off", "consistency"), choice, evidence, ref)).toBe("ask");
  });

  it("lets the agent rewrite the notes only for a typed line", () => {
    const rec = (text?: string): CheckRecord => ({ recordId: "row-1", kind: "sighting", fields: { registration: "G-ABCD", notes: "Retro livery" }, asTyped: {}, findings: [], ...(text !== undefined ? { text } : {}) });
    const answer = { records: [{ recordId: "row-1", verdict: "suspect", note: "", suggestions: [{ field: "notes", current: "Retro livery", suggested: "", confidence: "high", basis: "typed", reason: "Moved to the special livery." }] }] };
    const typed = checkAgentAnswer(answer, [rec("Retro livery")], ref);
    expect("records" in typed && typed.records[0]!.suggestions[0]).toMatchObject({ field: "notes", suggested: "", basis: "typed" });
    const file = checkAgentAnswer(answer, [rec()], ref);
    expect("rejected" in file && file.rejected[0]!.why).toMatch(/cannot be suggested/);
  });
});

describe("the inbox file", () => {
  const inbox = (over: Record<string, unknown> = {}): InboxFile =>
    ({
      schema: "touchdown-inbox",
      version: 1,
      createdAt: "2026-10-20T18:00Z",
      checker: "claude",
      sightings: [
        {
          values: { registration: "G-ABCD", date: "2026-10-20", airport: "EGLL", typeCode: "A21N", model: "A321-271NX", operator: "BAW", phase: "landing", specialLivery: "Retro" },
          sources: { registration: "you", date: "you", airport: "you", phase: "you", typeCode: "adsbdb", model: "opensky", operator: "your_log", specialLivery: "claude" },
          open: ["The agent: the date looks late for this aircraft."],
          missing: [],
          aircraft: { manufacturer: "Airbus", msn: "9001", lineNumber: null, firstFlightDate: null, provider: "opensky", url: null, fetchedAt: "2025-08-01T00:00Z" },
        },
        { values: { registration: "D-ABCD", date: "2026-10-20", airport: "EDDF" }, sources: { registration: "you" }, open: [], missing: ["typeCode", "operator", "phase"], aircraft: null },
      ],
      ...over,
    }) as InboxFile;

  it("becomes rows for the review, with what is open as warnings", () => {
    const r = readInbox(inbox(), "spot.json", ref);
    if ("error" in r) throw new Error(r.error);
    expect(r.source).toMatchObject({ format: "touchdown_inbox", rowsRead: 2, agentChecker: "claude" });
    const [a] = r.source.candidates;
    expect(a!.values).toMatchObject({ registration: "G-ABCD", seenOn: "2026-10-20", airportId: "ap_egll", operatorId: "op_baw", typeCode: "A21N", model: "A321-271NX", phase: "landing", specialLivery: "Retro", sourceKind: "manual" });
    expect(a!.issues).toEqual([{ ruleId: "I-SOURCE-DIFF", severity: "warning", field: null, message: "The agent: the date looks late for this aircraft." }]);
    expect(a!.provenance).toEqual([
      { field: "typeCode", source: "lookup", detail: "adsbdb" },
      { field: "model", source: "lookup", detail: "opensky" },
      { field: "operatorId", source: "derived", detail: "your log" },
      { field: "specialLivery", source: "agent", detail: "claude" },
    ]);
  });

  it("is saved with each value's source, and the serial number goes on the aircraft", () => {
    const r = readInbox(inbox(), "spot.json", ref);
    if ("error" in r) throw new Error(r.error);
    const store = newStore();
    const res = commitImport(store, ref, r.source, matchCandidates(store, r.source.candidates));
    expect(res.created).toBe(2);
    const batch = store.get("import_batches", res.batchId)!;
    expect(batch).toMatchObject({ sourceKind: "manual", mappingPreset: "touchdown_inbox", agentChecker: "claude", rowsEdited: 1 });
    const s = store.all("sightings").find((x) => x.registration === "G-ABCD")!;
    const prov = store.all("field_provenance").filter((p) => p.ownerId === s.id).map((p) => `${p.field}:${p.source}/${p.detail}`);
    expect(prov.sort()).toEqual(["model:lookup/opensky", "operatorId:derived/your log", "specialLivery:agent/claude", "typeCode:lookup/adsbdb"]);
    const a = store.get("airframes", s.airframeId)!;
    expect(a).toMatchObject({ msn: "9001", identityKey: "msn:airbus-a320:9001", provisional: false, factsProvider: "opensky" });
  });

  it("is refused when it carries anything unexpected", () => {
    const bad = (over: Record<string, unknown>, sighting: Record<string, unknown> = {}) => {
      const f = inbox(over);
      Object.assign(f.sightings[0]!, sighting);
      const r = readInbox(f, "spot.json", ref);
      return "error" in r ? r.error : null;
    };
    expect(bad({ extra: 1 })).toMatch(/unexpected keys/);
    expect(bad({ schema: "touchdown-check-result" })).toMatch(/not a Touchdown inbox/);
    expect(bad({}, { values: { registration: "G-ABCD", phase: "flying" } })).toMatch(/not a phase/);
    expect(bad({}, { values: { date: "2026-10-20" } })).toMatch(/no registration/);
    expect(bad({}, { sources: { typeCode: "somewhere" } })).toMatch(/unknown source/);
    expect(bad({}, { values: { registration: "G-ABCD", ticketNumber: "x" } })).toMatch(/not allowed/);
  });

  // Version 2 holds flights as well (`touchdown add`).
  const withFlights = (flight: Record<string, unknown>): InboxFile =>
    ({ schema: "touchdown-inbox", version: 2, createdAt: "2026-10-20T18:00Z", checker: null, sightings: [], flights: [{ values: {}, open: [], ...flight }] }) as InboxFile;

  it("reads a flight as a spreadsheet row with these columns, local times with their offsets", () => {
    const r = readInbox(
      withFlights({
        values: { date: "2026-10-18", flightNumber: "BA117", airline: "BAW", from: "EGLL", to: "KJFK", takeoff: "11:40", landing: "14:35", seat: "31K", class: "Economy", registration: "G-ABCD" },
        sources: { registration: "fr24" },
        open: ["Seat not on the boarding pass."],
      }),
      "add.json",
      ref,
    );
    if ("error" in r) throw new Error(r.error);
    const [c] = r.source.candidates;
    expect(c!.table).toBe("flights");
    expect(c!.values).toMatchObject({ scheduledDate: "2026-10-18", flightNumber: "BA117", airlineId: "op_baw", fromAirportId: "ap_egll", toAirportId: "ap_kjfk", seat: "31K", registration: "G-ABCD", sourceKind: "manual" });
    expect(c!.values).toMatchObject({ takeoffAt: "2026-10-18T11:40+01:00", landingAt: "2026-10-18T14:35-04:00" });
    expect(c!.issues).toContainEqual({ ruleId: "I-SOURCE-DIFF", severity: "warning", field: null, message: "Seat not on the boarding pass." });
    expect(c!.provenance).toEqual([{ field: "registration", source: "lookup", detail: "fr24" }]);
    expect(c!.raw).toEqual({ date: "2026-10-18", flightNumber: "BA117", airline: "BAW", from: "EGLL", to: "KJFK", takeoff: "11:40", landing: "14:35", seat: "31K", class: "Economy", registration: "G-ABCD" });
  });

  it("refuses private and unknown flight fields, and flights without a number, route or registration", () => {
    const bad = (flight: Record<string, unknown>) => {
      const r = readInbox(withFlights(flight), "add.json", ref);
      return "error" in r ? r.error : null;
    };
    expect(bad({ values: { flightNumber: "BA117", ticketNumber: "x" } })).toMatch(/not allowed/);
    expect(bad({ values: { flightNumber: "BA117", bookingRef: "x" } })).toMatch(/not allowed/);
    expect(bad({ values: { date: "2026-10-18" } })).toMatch(/no flight number, route or registration/);
    expect(bad({ values: { flightNumber: "BA117", date: "18/10/2026" } })).toMatch(/not a date/);
    expect(bad({ values: { flightNumber: "BA117" }, extra: 1 })).toMatch(/unexpected keys/);
    expect(readInbox({ ...withFlights({ values: { flightNumber: "BA117" } }), version: 1 }, "old.json", ref)).toEqual({ error: "unexpected keys: flights" });
    expect(readInbox({ ...withFlights({}), flights: [] }, "empty.json", ref)).toMatchObject({ error: expect.stringMatching(/no records/) });
  });
});

// Version 3 may hold a spreadsheet's rows instead (`touchdown import`). Every value is made up.
describe("a spreadsheet in the inbox", () => {
  const FR24 = ["Date", "Flight number", "From", "To", "Dep time", "Arr time", "Duration", "Airline", "Aircraft", "Registration"];
  const withSheet = (sheet: Record<string, unknown>, over: Record<string, unknown> = {}) =>
    ({ schema: "touchdown-inbox", version: 3, createdAt: "2026-10-20T18:00Z", checker: null, sightings: [], sheet: { fileName: "flights.csv", name: "flights.csv", firstRow: 2, ...sheet }, ...over }) as unknown as InboxFile;
  const mapped = { header: ["Date", "Flight", "From", "To", "Seat"], rows: [["2026-10-18", "BA117", "EGLL", "KJFK", "31K"]], mapping: { kind: "flights", fields: ["date", "flightNumber", "from", "to", "seat"] } };

  it("reads as the Import page reads the file: with its columns, or as the Flightradar24 export", () => {
    const r = readInbox(withSheet(mapped), "import-a.json", ref);
    if ("error" in r) throw new Error(r.error);
    expect(r.source).toMatchObject({ format: "sheet", fileName: "flights.csv", rowsRead: 1 });
    expect(r.source.candidates[0]).toMatchObject({ table: "flights", sourceRow: 2, values: { scheduledDate: "2026-10-18", flightNumber: "BA117", fromAirportId: "ap_egll", toAirportId: "ap_kjfk", seat: "31K" } });
    expect(r.changes).toEqual([]);

    const fr24 = readInbox(withSheet({ header: FR24, rows: [["2026-10-18", "BA117", "London (LHR/EGLL)", "New York (JFK/KJFK)", "11:40:00", "14:35:00", "07:55:00", "British Airways (BA/BAW)", "Airbus A321neo (A21N)", "G-ABCD"]], mapping: null }), "import-b.json", ref);
    if ("error" in fr24) throw new Error(fr24.error);
    expect(fr24.source).toMatchObject({ format: "fr24_csv", rowsRead: 1 });
    expect(fr24.source.candidates[0]!.values).toMatchObject({ flightNumber: "BA117", fromAirportId: "ap_egll", registration: "G-ABCD" });
  });

  it("is refused when malformed, without its columns, or with anything besides it", () => {
    const bad = (sheet: Record<string, unknown>, over: Record<string, unknown> = {}) => {
      const r = readInbox(withSheet({ ...mapped, ...sheet }, over), "import.json", ref);
      return "error" in r ? r.error : null;
    };
    expect(bad({ mapping: null })).toMatch(/not the Flightradar24 export/);
    expect(bad({ mapping: { kind: "flights", fields: ["date", "flightNumber"] } })).toMatch(/malformed columns/);
    expect(bad({ mapping: { kind: "flights", fields: ["date", "flightNumber", "from", "to", "wingspan"] } })).toMatch(/malformed columns/);
    expect(bad({ mapping: { kind: "flights", fields: ["ignore", "ignore", "ignore", "ignore", "seat"] } })).toMatch(/^spreadsheet: /);
    expect(bad({ rows: [["2026-10-18", "BA117"]] })).toMatch(/row 1 is malformed/);
    expect(bad({ rows: [] })).toMatch(/no rows/);
    expect(bad({ extra: 1 })).toMatch(/unexpected keys extra/);
    expect(bad({}, { flights: [{ values: { flightNumber: "BA118" }, open: [] }] })).toMatch(/holds nothing else/);
    expect(bad({}, { version: 2 })).toMatch(/unexpected keys: sheet/);
  });
});
