import { describe, expect, it } from "vitest";
import { logCheckRecord, logEvidence, logRecordFingerprint, logRecordKey, recordsToCheck, RefIndex, saveFlight, saveSighting, setPhases, sightingEdit, suggestionEditInput, type LogRecord } from "../src/index.ts";
import { newStore, refTables } from "./fixtures.ts";

// Every registration, flight number and date here is made up.
function aLog() {
  const ref = new RefIndex(refTables);
  const store = newStore();
  const flight = saveFlight(store, ref, { scheduledDate: "2025-03-14", flightNumber: "BA9001", airlineRaw: "BA", fromRaw: "LHR", toRaw: "JFK", registrationRaw: "G-ZZZA", typeCodeRaw: "B77W" }).row;
  const seen = saveSighting(store, ref, { seenOn: "2026-01-10", airportRaw: "KBOS", registrationRaw: "N9001Z", typeCodeRaw: "B738", operatorRaw: "DAL", notes: "near the fence" }).row;
  const again = saveSighting(store, ref, { seenOn: "2026-02-01", airportRaw: "KBOS", registrationRaw: "N9001Z", typeCodeRaw: "B739", operatorRaw: "DAL" }).row;
  return { ref, store, flight, seen, again };
}

const rec = (table: "flights" | "sightings", row: unknown) => ({ table, row }) as LogRecord;

describe("the records a log check takes", () => {
  it("takes those the agent has not seen as they are, and leaves an import it checked", () => {
    const { ref, store, flight, seen, again } = aLog();
    const ids = (list: LogRecord[]) => list.map((r) => r.row.id);
    // One aircraft's records together, by registration, then by date.
    expect(ids(recordsToCheck(store, ref, new Map()))).toEqual([flight.id, seen.id, again.id]);

    const checked = new Map([[logRecordKey(rec("sightings", seen)), logRecordFingerprint(store, ref, rec("sightings", seen))]]);
    expect(ids(recordsToCheck(store, ref, checked))).toEqual([flight.id, again.id]);
    // Changed since it was checked: taken again.
    saveSighting(store, ref, { ...seen, typeCodeRaw: "B39M" }, seen.id);
    expect(ids(recordsToCheck(store, ref, checked))).toContain(seen.id);

    // A record whose import the agent checked is not taken unless asked for.
    const batch = store.insert("import_batches", { createdAt: "2026-02-02T10:00Z", sourceKind: "sheet", fileName: "spot.json", rowsRead: 1, agentChecker: "claude", status: "committed" });
    store.update("flights", flight.id, { sourceBatchId: batch.id });
    expect(ids(recordsToCheck(store, ref, new Map()))).not.toContain(flight.id);
    expect(ids(recordsToCheck(store, ref, new Map(), { all: true }))).toContain(flight.id);
    expect(recordsToCheck(store, ref, new Map(), { since: "2999-01-01" })).toEqual([]);
  });
});

describe("a record in the log as the agent is sent it", () => {
  it("has its fields, what was typed where it differs, its notes only when asked, and what lookups say", () => {
    const { ref, store, seen } = aLog();
    const r = logCheckRecord(store, ref, rec("sightings", seen), { recordId: "row-2", findings: [], evidence: [{ source: "opensky", typeCode: "B738", model: null, operator: "DAL", asOf: null, note: null }], includeNotes: false });
    expect(r).toMatchObject({ recordId: "row-2", kind: "sighting", fields: { registration: "N9001Z", typeCode: "B738", operator: "DAL", airport: "BOS", date: "2026-01-10" }, asTyped: { airport: "KBOS" } });
    expect(r.notes).toBeUndefined();
    expect(r.evidence).toHaveLength(1);
    expect(logCheckRecord(store, ref, rec("sightings", seen), { recordId: "row-2", findings: [], evidence: [], includeNotes: true }).notes).toBe("near the fence");
  });

  it("carries a sighting's phase only when it was seen in one", () => {
    const { ref, store, seen } = aLog();
    setPhases(store, seen.id, ["landing"]);
    expect(logCheckRecord(store, ref, rec("sightings", seen), { recordId: "row-1", findings: [], evidence: [], includeNotes: false }).fields.phase).toBe("landing");
    setPhases(store, seen.id, ["landing", "taxiing"]);
    expect(logCheckRecord(store, ref, rec("sightings", seen), { recordId: "row-1", findings: [], evidence: [], includeNotes: false }).fields.phase).toBeUndefined();
    // Nor can a suggestion replace them with one.
    expect(suggestionEditInput(store, rec("sightings", seen), [{ field: "phase", suggested: "parked" }])).toEqual({});
  });

  it("leaves the record itself out of what the log says about its aircraft", () => {
    const { ref, store, seen, again } = aLog();
    // Without it, the nearest record to its own date would be itself.
    expect(logEvidence(store, ref, "N9001Z", "2026-01-10")).toMatchObject({ asOf: seen.seenOn });
    expect(logEvidence(store, ref, "N9001Z", "2026-01-10", { id: seen.id })).toMatchObject({ source: "your_log", asOf: again.seenOn });
  });
});

describe("the suggestions taken, as an edit", () => {
  it("names the fields as edit does, and an empty one clears the field", () => {
    const { ref, store, seen } = aLog();
    const input = suggestionEditInput(store, rec("sightings", seen), [
      { field: "operator", suggested: "UAL" },
      { field: "specialLivery", suggested: "" },
      { field: "flightNumber", suggested: "UA1" },
    ]);
    expect(input).toEqual({ airline: "UAL", specialLivery: null });
    const r = sightingEdit(store, ref, seen, input);
    if ("error" in r) throw new Error(r.error);
    expect(r.change.set).toMatchObject({ operatorId: "op_ual" });
  });
});
