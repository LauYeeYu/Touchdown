import { describe, expect, it } from "vitest";
import {
  agentPayload,
  AGENT_OUTPUT_SCHEMA,
  applySuggestions,
  buildCheckRequest,
  checkAgentAnswer,
  checkBatchId,
  commitImport,
  matchCandidates,
  parseSource,
  readCheckRequest,
  readCheckResult,
  readCsv,
  recordIdOf,
  storedFields,
  type CheckResultFile,
} from "../src/index.ts";
import { newStore, ref } from "./fixtures.ts";

// Made-up spotting rows: a 757 written with a 737 type code, a special livery spelled loosely, and a note.
const SPOTTING = `Registration,Date,Location,Airlines,Country,Manufacturer,Plane Family,Type Code,Aircraft,Status,Special Livery,Misc
N4001X,45000,EGLL,BAW,US,Boeing,B757,B738,B757-224,Landing,,Taken from the car park
D-ABCE,45001,EDDF,DLH,Germany,Boeing,B777,B77W,B777-3Z9(ER),Parked,retro livery ,`;

// Made-up flight log rows: the ticket number and seat must never reach the agent.
const LOG = `Date,Airlines,Flight Number,Seat,Class,Departure,Gate,Boarding Time,Departure Time,Destination,Landing Time,Duration,Distance (km),Route,ETKT,Manufacturer,Plane Family,Type Code,Aircraft,Registration Number,First Flight Date,Special Livery,Misc
14-Mar-2025,BA,BA123,14A,Economy,LHR,B32,10:00,10:40,FRA,13:30,01:50,650,LHR-FRA,1234567890123/1,Airbus,A320,A321,A321-211,N5001X,,,`;

const spotting = () => parseSource(readCsv(SPOTTING), "photos.csv", ref)!;

describe("the check request", () => {
  it("keys rows by their row in the file and sends only the allowed fields", () => {
    const req = buildCheckRequest(spotting(), ref, { batchId: "chk-0000000000000001" });
    expect(req.records.map((r) => r.recordId)).toEqual(["row-2", "row-3"]);
    expect(req.records[0]).toMatchObject({ kind: "sighting", fields: { registration: "N4001X", typeCode: "B738", model: "757-224", airport: "LHR", operator: "BAW", phase: "landing" } });
    expect(req.records[0]!.asTyped).toMatchObject({ airport: "EGLL", model: "B757-224" });
    expect(req.records[0]!.notes).toBeUndefined();
    expect(buildCheckRequest(spotting(), ref, { batchId: "chk-0000000000000001", includeNotes: true }).records[0]!.notes).toBe("Taken from the car park");
  });

  it("never carries a ticket number, booking reference or seat", () => {
    const src = parseSource(readCsv(LOG), "log.csv", ref)!;
    const text = JSON.stringify(buildCheckRequest(src, ref, { batchId: "chk-0000000000000002", includeNotes: true }));
    expect(text).not.toContain("1234567890123");
    expect(text).not.toContain("14A");
    expect(text).toContain("BA123");
  });

  it("refuses a request with anything extra or malformed", () => {
    const req = buildCheckRequest(spotting(), ref, { batchId: "chk-0000000000000001" });
    expect("request" in readCheckRequest(JSON.parse(JSON.stringify(req)))).toBe(true);
    const extra = JSON.parse(JSON.stringify(req));
    extra.records[0].fields.ticketNumber = "1234567890123";
    expect(readCheckRequest(extra)).toEqual({ error: "row-2: field ticketNumber is not allowed" });
    const added = { ...JSON.parse(JSON.stringify(req)), token: "x" };
    expect("error" in readCheckRequest(added)).toBe(true);
    expect("error" in readCheckRequest({ ...req, batchId: "../../etc" })).toBe(true);
  });

  it("gives the same batch id to the same bytes", async () => {
    const bytes = new TextEncoder().encode(SPOTTING);
    expect(await checkBatchId(bytes)).toBe(await checkBatchId(new TextEncoder().encode(SPOTTING)));
    expect(await checkBatchId(bytes)).toMatch(/^chk-[0-9a-f]{16}$/);
  });

  it("sends each batch the family of every type it names, with example models", () => {
    const req = buildCheckRequest(spotting(), ref, { batchId: "chk-0000000000000001" });
    const p = agentPayload(req.records, req.rules, ref);
    const designators = p.reference.types.map((t) => t.designator);
    expect(designators).toContain("B738");
    expect(designators).toContain("B752"); // from the model 757-224
    expect(p.reference.types.find((t) => t.designator === "B752")?.models).toEqual(["757-224"]);
    expect(p.reference.operators.map((o) => o.icao).sort()).toEqual(["BAW", "DLH"]);
  });
});

describe("checking an agent's answer", () => {
  const req = buildCheckRequest(spotting(), ref, { batchId: "chk-0000000000000001" });
  const s = (field: string, suggested: string, confidence = "high") => ({ field, current: "", suggested, confidence, basis: "reference_data", reason: "Because." });

  it("keeps suggestions that pass and reports the rest", () => {
    const r = checkAgentAnswer(
      {
        records: [
          { recordId: "row-2", verdict: "wrong", note: "", suggestions: [s("typeCode", "B752"), s("registration", "PWNED-1"), s("flightNumber", "BA1")] },
          { recordId: "row-3", verdict: "suspect", note: "", suggestions: [s("specialLivery", "Retro Livery", "medium"), s("typeCode", "B77W")] },
          { recordId: "row-99", verdict: "wrong", note: "", suggestions: [] },
        ],
      },
      req.records,
      ref,
    );
    if ("error" in r) throw new Error(r.error);
    expect(r.records.map((x) => [x.recordId, x.suggestions.map((y) => `${y.field}=${y.suggested}`)])).toEqual([
      ["row-2", ["typeCode=B752"]],
      ["row-3", ["specialLivery=Retro Livery"]], // B77W is what the row has already
    ]);
    expect(r.records[0]!.suggestions[0]!.current).toBe("B738");
    expect(r.rejected.map((x) => `${x.recordId} ${x.field}: ${x.why}`)).toEqual([
      `row-2 registration: "PWNED-1" does not match any country's registration format`,
      "row-2 flightNumber: flightNumber cannot be suggested for a sighting",
      "row-99 : not a record in this batch",
    ]);
  });

  it("leaves out rows the agent found nothing wrong with", () => {
    const r = checkAgentAnswer({ records: [{ recordId: "row-2", verdict: "ok", note: "", suggestions: [] }] }, req.records, ref);
    expect(r).toEqual({ records: [], rejected: [] });
  });

  it("has a strict schema", () => {
    expect(AGENT_OUTPUT_SCHEMA.additionalProperties).toBe(false);
    expect(AGENT_OUTPUT_SCHEMA.properties.records.items.required).toEqual(["recordId", "verdict", "note", "suggestions"]);
  });

  it("reads a result file only for the same file, and checks it again", () => {
    const file: CheckResultFile = {
      schema: "touchdown-check-result",
      version: 1,
      batchId: req.batchId,
      checker: "claude",
      checkerVersion: "1.0.0",
      model: null,
      checkedAt: "2026-10-21T00:00:00Z",
      checked: 2,
      records: [{ recordId: "row-2", verdict: "wrong", note: "", suggestions: [{ field: "typeCode", current: "B738", suggested: "B999", confidence: "high", basis: "model_knowledge", reason: "x" }] }],
      rejected: [],
      failed: [],
    };
    expect(readCheckResult({ ...file, batchId: "chk-ffffffffffffffff" }, req, ref)).toMatchObject({ error: expect.stringContaining("another file") });
    const r = readCheckResult(file, req, ref);
    if ("error" in r) throw new Error(r.error);
    expect(r.dropped).toBe(1); // B999 is not a type
    expect(r.result.records).toEqual([]);
  });
});

describe("using suggestions", () => {
  it("changes a copy of the rows and records where the values came from", () => {
    const source = spotting();
    const accepted = new Map([["row-2", [{ field: "typeCode" as const, current: "B738", suggested: "b752", confidence: "high" as const, basis: "reference_data" as const, reason: "" }]]]);
    const patched = applySuggestions(source, accepted, ref);
    expect(patched.candidates[0]!.values).toMatchObject({ typeCode: "B752", typeCodeRaw: "B738" });
    expect(source.candidates[0]!.values).toMatchObject({ typeCode: "B738" });

    const store = newStore();
    const fields = new Map([[0, storedFields("sighting", "typeCode")]]);
    const r = commitImport(store, ref, patched, matchCandidates(store, patched.candidates), new Map(), { agent: { checker: "claude", fields } });
    const id = store.all("sightings").find((x) => x.sourceRow === 2)!.id;
    expect(store.get("sightings", id)!.typeCode).toBe("B752");
    expect(store.all("field_provenance").filter((p) => p.source === "agent")).toMatchObject([{ ownerTable: "sightings", ownerId: id, field: "typeCode", detail: "claude" }]);
    expect(store.get("import_batches", r.batchId)).toMatchObject({ agentChecker: "claude", rowsEdited: 1 });
    expect(recordIdOf(patched.candidates[0]!)).toBe("row-2");
  });
});
