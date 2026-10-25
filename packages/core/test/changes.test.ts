import { describe, expect, it } from "vitest";
import {
  phasesOf,
  airframeEdit,
  applyChanges,
  checkAll,
  flightEdit,
  readChanges,
  RefIndex,
  saveFlight,
  saveSighting,
  sightingEdit,
  tagsOf,
  undoImport,
  type InboxChange,
} from "../src/index.ts";
import { planChanges } from "../src/view/index.ts";
import { newStore, refTables } from "./fixtures.ts";

// Every flight number, registration, date and private value here is made up.
const NOW = Date.UTC(2026, 9, 24, 12);

function aLog() {
  const ref = new RefIndex(refTables);
  const store = newStore();
  const flight = saveFlight(store, ref, { scheduledDate: "2025-03-14", flightNumber: "BA9001", airlineRaw: "BA", fromRaw: "LHR", toRaw: "JFK", takeoffAt: "2025-03-14T11:00+00:00", seat: "12A", departureGate: "B7", registrationRaw: "G-ZZZA", typeCodeRaw: "B77W", ticketNumber: "0019990000001" }).row;
  const sighting = saveSighting(store, ref, { seenOn: "2026-01-10", airportRaw: "KBOS", registrationRaw: "N9001Z", typeCodeRaw: "B738", operatorRaw: "DAL", phase: "landing" }, undefined, ["night"]).row;
  return { ref, store, flight, sighting };
}

describe("building a change from the fields add takes", () => {
  it("reads a flight's times on its date at its airports, links what is named again, and clears what is empty", () => {
    const { ref, store, flight } = aLog();
    const r = flightEdit(store, ref, flight, { seat: "14A", takeoff: "11:40", airline: "DL", gate: "", reason: "Leisure" });
    if ("error" in r) throw new Error(r.error);
    expect(r.change).toMatchObject({ op: "edit", table: "flights", id: flight.id, rev: flight.rev, clear: ["departureGate"] });
    expect(r.change.set).toEqual({ seat: "14A", takeoffAt: "2025-03-14T11:40+00:00", airlineRaw: "DL", airlineId: "op_dal", reason: "leisure" });
    expect(flightEdit(store, ref, flight, { aircraft: "x" })).toMatchObject({ error: expect.stringMatching(/aircraft is not a field/) });
    expect(flightEdit(store, ref, flight, { seatPosition: "upstairs" })).toMatchObject({ error: expect.stringMatching(/seatPosition is one of window, middle, aisle/) });
  });

  it("changes a sighting's phase, time, tags and airline, and an aircraft's facts", () => {
    const { ref, store, sighting } = aLog();
    const r = sightingEdit(store, ref, sighting, { phase: "Taking off", time: "09:15", tags: "night, backlit", airline: "" });
    if ("error" in r) throw new Error(r.error);
    expect(r.change.set).toEqual({ seenAt: "2026-01-10T09:15-05:00" });
    expect(r.change.phases).toEqual(["taking_off"]);
    const several = sightingEdit(store, ref, sighting, { phase: "taxiing, landing" });
    if ("error" in several) throw new Error(several.error);
    expect(several.change.phases).toEqual(["landing", "taxiing"]);
    expect(r.change.clear.sort()).toEqual(["operatorId", "operatorRaw"]);
    expect(r.change.tags).toEqual(["night", "backlit"]);
    const a = store.get("airframes", sighting.airframeId)!;
    const facts = airframeEdit(a, { msn: "30001", firstFlight: "2019-05-01" });
    if ("error" in facts) throw new Error(facts.error);
    expect(facts.change).toMatchObject({ op: "airframe", set: { msn: "30001", firstFlightDate: "2019-05-01" }, clear: [] });
  });
});

describe("reading the changes of an inbox file", () => {
  it("takes the ops of docs/34 and refuses anything else", () => {
    expect(readChanges([{ op: "edit", table: "flights", id: "01JABCDEFGHJKMNPQRSTVWXYZ0", rev: 2, set: { seat: "14A" }, clear: [] }])).toMatchObject({ changes: [{ op: "edit" }] });
    expect(readChanges([{ op: "edit", table: "flights", id: "x", rev: 2, set: { airframeId: "y" }, clear: [] }])).toMatchObject({ error: expect.stringMatching(/airframeId cannot be set/) });
    expect(readChanges([{ op: "drop", id: "x" }])).toMatchObject({ error: "change 1 is malformed" });
    expect(readChanges([{ op: "accept", ruleId: "V-NOT-A-RULE", fingerprint: "0011aabb", note: null }])).toMatchObject({ error: expect.stringMatching(/unknown finding/) });
    expect(readChanges([{ op: "settings", set: { codeDisplay: "faa" } }])).toMatchObject({ error: expect.stringMatching(/codeDisplay cannot be faa/) });
  });
});

describe("a change file's review", () => {
  it("shows each change before and after, hides private values unless asked, and changes nothing", () => {
    const { ref, store, flight } = aLog();
    const edit = flightEdit(store, ref, flight, { seat: "14A", ticketNumber: "0019990000002", typeCode: "QQQQ" });
    if ("error" in edit) throw new Error(edit.error);
    const before = JSON.stringify(store.all("flights"));
    const plan = planChanges(store, ref, [edit.change]);
    expect(plan.changes[0]).toMatchObject({ action: "Edit", title: "BA9001 · 14 Mar 2025 · LHR → JFK", status: "pending" });
    expect(plan.changes[0]!.lines.map((l) => [l.label, l.before, l.after])).toEqual([
      ["Seat", "12A", "14A"],
      ["Type", "Boeing 777-300ER (B77W)", "QQQQ (QQQQ)"],
      ["Ticket number", "recorded", "changed"],
    ]);
    expect(JSON.stringify(plan)).not.toContain("0019990000001");
    expect(JSON.stringify(plan)).not.toContain("0019990000002");
    const shown = planChanges(store, ref, [edit.change], { showPrivate: true });
    expect(shown.changes[0]!.lines.find((l) => l.field === "ticketNumber")).toMatchObject({ before: "0019990000001", after: "0019990000002", private: true });
    // The unknown type is a finding the change brings.
    expect(plan.findings.map((f) => f.ruleId)).toContain("V-TYPE-KNOWN");
    expect(JSON.stringify(store.all("flights"))).toBe(before);
  });

  it("leaves a record changed since the edit was made, unless the user takes it", () => {
    const { ref, store, flight } = aLog();
    const edit = flightEdit(store, ref, flight, { seat: "14A" });
    if ("error" in edit) throw new Error(edit.error);
    saveFlight(store, ref, { ...flight, notes: "changed in the web app" }, flight.id);
    expect(planChanges(store, ref, [edit.change]).changes[0]).toMatchObject({ status: "changed", note: expect.stringMatching(/changed after/) });
    const left = applyChanges(store, ref, [edit.change], (_, s) => s === "pending", { fileName: "edit.json", now: NOW });
    expect(left).toMatchObject({ applied: 0, skipped: 1 });
    expect(store.get("flights", flight.id)!.seat).toBe("12A");
    applyChanges(store, ref, [edit.change], () => true, { fileName: "edit.json", now: NOW });
    expect(store.get("flights", flight.id)).toMatchObject({ seat: "14A", notes: "changed in the web app" });
  });
});

describe("importing a change file", () => {
  it("applies the changes as one batch, and undoing it puts every row back", () => {
    const { ref, store, flight, sighting } = aLog();
    // A finding to accept: the registration's country differs from the airline's (G- on a US airline).
    const extra = saveFlight(store, ref, { scheduledDate: "2025-04-02", flightNumber: "DL9002", airlineRaw: "DL", fromRaw: "JFK", toRaw: "BOS", registrationRaw: "G-ZZZB", typeCodeRaw: "A21N" }).row;
    const finding = checkAll(store, ref).find((f) => f.ruleId === "V-REG-COUNTRY" && f.records[0]!.id === extra.id)!;
    // The flight's aircraft: the sighting's, provisional, goes with the sighting when it is deleted.
    const airframeId = store.get("flights", flight.id)!.airframeId!;
    const changes: InboxChange[] = [
      { op: "edit", table: "flights", id: flight.id, rev: flight.rev, set: { seat: "14A" }, clear: ["departureGate"] },
      { op: "delete", table: "sightings", id: sighting.id, rev: sighting.rev },
      { op: "airframe", id: airframeId, rev: store.get("airframes", airframeId)!.rev, set: { msn: "30001" }, clear: [] },
      { op: "accept", ruleId: finding.ruleId, fingerprint: finding.fingerprint, note: "leased" },
      { op: "family", designator: "E75L", familyId: "A320" },
      { op: "settings", set: { codeDisplay: "icao" } },
    ];
    expect(planChanges(store, ref, changes).changes.map((c) => c.status)).toEqual(["pending", "pending", "pending", "pending", "pending", "pending"]);
    const r = applyChanges(store, ref, changes, () => true, { fileName: "edit-2026-10-24-1200.json", now: NOW });
    expect(r).toMatchObject({ applied: 6, skipped: 0 });
    expect(store.get("flights", flight.id)).toMatchObject({ seat: "14A", departureGate: null, ticketNumber: "0019990000001" });
    expect(store.get("sightings", sighting.id)).toBeNull();
    expect(store.get("airframes", airframeId)).toMatchObject({ msn: "30001", provisional: false });
    expect(store.all("issue_acks")).toMatchObject([{ ruleId: "V-REG-COUNTRY", note: "leased" }]);
    expect(store.all("family_overrides")).toMatchObject([{ designator: "E75L", familyId: "A320" }]);
    expect(store.get("settings", "settings")).toMatchObject({ codeDisplay: "icao" });
    expect(store.get("import_batches", r.batchId)).toMatchObject({ fileName: "edit-2026-10-24-1200.json", rowsAccepted: 6, status: "committed" });
    // Done already: a second import does nothing.
    expect(planChanges(store, ref, changes).open).toBe(0);

    undoImport(store, ref, r.batchId);
    expect(store.get("flights", flight.id)).toMatchObject({ seat: "12A", departureGate: "B7" });
    expect(store.get("sightings", sighting.id)).toMatchObject({ registration: "N9001Z" });
    expect(phasesOf(store, sighting.id)).toEqual(["landing"]);
    expect(tagsOf(store, sighting.id)).toEqual(["night"]);
    expect(store.get("airframes", airframeId)).toMatchObject({ msn: null });
    expect(store.all("issue_acks")).toEqual([]);
    expect(store.all("family_overrides")).toEqual([]);
    expect(store.get("settings", "settings")).toBeNull();
    expect(store.get("import_batches", r.batchId)!.status).toBe("undone");
  });

  it("leaves a record a later import changed when an earlier one is undone, unless forced", () => {
    const { ref, store, flight } = aLog();
    const first = applyChanges(store, ref, [{ op: "edit", table: "flights", id: flight.id, rev: flight.rev, set: { seat: "14A" }, clear: [] }], () => true, { fileName: "edit-1.json", now: NOW });
    const now = store.get("flights", flight.id)!;
    applyChanges(store, ref, [{ op: "edit", table: "flights", id: flight.id, rev: now.rev, set: { notes: "later" }, clear: [] }], () => true, { fileName: "edit-2.json", now: NOW + 60_000 });
    const r = undoImport(store, ref, first.batchId);
    expect(r.editedSince).toContain(flight.id);
    expect(store.get("flights", flight.id)).toMatchObject({ seat: "14A", notes: "later" });
    undoImport(store, ref, first.batchId, true);
    expect(store.get("flights", flight.id)).toMatchObject({ seat: "12A", notes: null });
  });

  it("says what an undo leaves, and undoes it too when forced", () => {
    const { ref, store, flight } = aLog();
    const first = applyChanges(store, ref, [{ op: "edit", table: "flights", id: flight.id, rev: flight.rev, set: { seat: "14A" }, clear: [] }], () => true, { fileName: "edit-1.json", now: NOW });
    // Changed in the web app afterwards.
    saveFlight(store, ref, { ...store.get("flights", flight.id)!, notes: "later" }, flight.id, { now: NOW + 60_000 });
    const left = applyChanges(store, ref, [{ op: "undo", batchId: first.batchId }], () => true, { fileName: "undo-1.json", now: NOW + 120_000 });
    expect(left.messages).toEqual(["1 record changed after that import was left as it is; the import stays to undo."]);
    expect(store.get("flights", flight.id)!.seat).toBe("14A");
    applyChanges(store, ref, [{ op: "undo", batchId: first.batchId, force: true }], () => true, { fileName: "undo-2.json", now: NOW + 180_000 });
    expect(store.get("flights", flight.id)).toMatchObject({ seat: "12A", notes: null });
  });

  it("applies a suggested fix and undoes an earlier import", () => {
    const { ref, store } = aLog();
    const s = saveSighting(store, ref, { seenOn: "2026-05-01", airportRaw: "KBOS", registrationRaw: "N9003Z", typeCodeRaw: "B73X", modelRaw: "B737-8H4" }).row;
    const f = checkAll(store, ref).find((x) => x.ruleId === "V-TYPE-KNOWN" && x.records[0]!.id === s.id)!;
    const first = applyChanges(store, ref, [{ op: "fix", ruleId: f.ruleId, fingerprint: f.fingerprint, fix: 0 }], () => true, { fileName: "issues.json", now: NOW });
    expect(store.get("sightings", s.id)).toMatchObject({ typeCode: "B738" });
    applyChanges(store, ref, [{ op: "undo", batchId: first.batchId }], () => true, { fileName: "undo.json", now: NOW + 1000 });
    expect(store.get("sightings", s.id)).toMatchObject({ typeCode: "B73X" });
    expect(store.get("import_batches", first.batchId)!.status).toBe("undone");
  });
});

describe("saved Statistics views in a change file", () => {
  it("are checked, saved and removed with their filters, and undo puts them back", () => {
    const { ref, store } = aLog();
    expect(readChanges([{ op: "view", name: "Mine", dataset: "flights", rowDimension: "phase", columnDimension: null, measure: "records" }])).toMatchObject({ error: expect.stringMatching(/phase is for sightings/) });
    expect(readChanges([{ op: "view", name: "Mine", dataset: "sightings", rowDimension: "airline", columnDimension: null, measure: "distance" }])).toMatchObject({ error: expect.stringMatching(/flights only/) });
    expect(readChanges([{ op: "view", name: "Mine", dataset: "flights", rowDimension: "airline", columnDimension: "airline", measure: "records" }])).toMatchObject({ error: expect.stringMatching(/two different/) });
    expect(readChanges([{ op: "view", name: "", dataset: "flights", rowDimension: "airline", columnDimension: null, measure: "records" }])).toMatchObject({ error: expect.stringMatching(/malformed name/) });

    const save: InboxChange = { op: "view", name: "Airlines by family", dataset: "flights", rowDimension: "airline", columnDimension: "family", measure: "records" };
    expect(readChanges([save])).toEqual({ changes: [save] });
    const plan = planChanges(store, ref, [save]);
    expect(plan.changes[0]).toMatchObject({ action: "Save a view", title: "“Airlines by family”", status: "pending" });
    expect(plan.changes[0]!.lines.map((l) => [l.label, l.after])).toEqual([["From", "Flights"], ["Count", "Number of flights"], ["Group by", "Airline"], ["Split by", "Family"]]);
    const saved = applyChanges(store, ref, [save], () => true, { fileName: "stats-1.json", now: NOW });
    const view = store.all("saved_views")[0]!;
    expect(view).toMatchObject({ name: "Airlines by family", dataset: "flights", rowDimension: "airline", columnDimension: "family", measure: "records" });
    expect(planChanges(store, ref, [save]).changes[0]!.status).toBe("done");

    store.insert("saved_view_filters", { viewId: view.id, dimension: "airline", operator: "eq", value: "op_baw" });
    const removed = applyChanges(store, ref, [{ op: "removeView", id: view.id }], () => true, { fileName: "stats-2.json", now: NOW + 1000 });
    expect(store.all("saved_views")).toEqual([]);
    expect(store.all("saved_view_filters")).toEqual([]);
    undoImport(store, ref, removed.batchId);
    expect(store.all("saved_views")).toMatchObject([{ id: view.id, name: "Airlines by family" }]);
    expect(store.all("saved_view_filters")).toHaveLength(1);
    undoImport(store, ref, saved.batchId, true);
    expect(store.all("saved_views")).toEqual([]);
  });
});
