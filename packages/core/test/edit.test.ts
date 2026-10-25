import { describe, expect, it } from "vitest";
import {
  acceptFinding,
  applyFix,
  checkAll,
  deleteRecord,
  mergeAirframes,
  RefIndex,
  reopenFinding,
  saveFlight,
  saveSighting,
  saveSightings,
  setFamily,
  settingsOf,
  tagsOf,
  updateAirframe,
  updateSettings,
} from "../src/index.ts";
import { newStore, refTables } from "./fixtures.ts";

// Every registration, flight number and date here is made up.
const NOW = Date.UTC(2026, 9, 24, 12);
const history = (store: ReturnType<typeof newStore>, id: string) => store.all("record_history").filter((h) => h.recordId === id);

describe("changes to the log", () => {
  it("adds a flight, and keeps the version an edit replaces", () => {
    const ref = new RefIndex(refTables);
    const store = newStore();
    const { row } = saveFlight(store, ref, { scheduledDate: "2025-04-02", flightNumber: "DL300", airlineRaw: "DL", fromRaw: "BOS", toRaw: "SEA", seat: "12A" });
    expect(row).toMatchObject({ sourceKind: "manual", flightNumber: "DL300", airlineId: "op_dal", seat: "12A" });
    expect(history(store, row.id)).toHaveLength(0);

    const edited = saveFlight(store, ref, { ...row, seat: "14A" }, row.id, { now: NOW }).row;
    expect(edited.seat).toBe("14A");
    expect(history(store, row.id)).toMatchObject([{ recordRev: row.rev, reason: "edit", changedAt: "2026-10-24T12:00:00Z" }]);
    expect((history(store, row.id)[0]!.row as { seat: string }).seat).toBe("12A");
  });

  it("makes a company's name in the airline field the user's own operator", () => {
    const ref = new RefIndex(refTables);
    const store = newStore();
    const { row } = saveSighting(store, ref, { seenOn: "2026-05-01", airportRaw: "KBOS", registrationRaw: "G-ABCD", operatorRaw: "Example Motors" });
    const op = store.all("operator_overrides");
    expect(op.map((o) => o.name)).toEqual(["Example Motors"]);
    expect(row.operatorId).toBe(op[0]!.id);
  });

  it("keeps a sighting's tags with it, and deletes them with it", () => {
    const ref = new RefIndex(refTables);
    const store = newStore();
    const { row } = saveSighting(store, ref, { seenOn: "2026-05-01", airportRaw: "KBOS", registrationRaw: "N1001X", typeCodeRaw: "B738" }, undefined, ["retro", "night"]);
    expect(tagsOf(store, row.id).sort()).toEqual(["night", "retro"]);
    saveSighting(store, ref, row, row.id, ["night"]);
    expect(tagsOf(store, row.id)).toEqual(["night"]);
    const { count } = saveSightings(store, ref, [{ values: { seenOn: "2026-05-02", airportRaw: "KBOS", registrationRaw: "N1002X" } }, { values: { seenOn: "2026-05-02", airportRaw: "KBOS", registrationRaw: "N1003X" }, tags: ["first"] }]);
    expect(count).toBe(2);

    deleteRecord(store, ref, "sightings", row.id);
    expect(store.get("sightings", row.id)).toBeNull();
    expect(tagsOf(store, row.id)).toEqual([]);
    expect(history(store, row.id).at(-1)!.reason).toBe("edit");
  });

  it("confirms an airframe given its serial number, and merges two into one", () => {
    const ref = new RefIndex(refTables);
    const store = newStore();
    const a = saveSighting(store, ref, { seenOn: "2025-05-01", airportRaw: "KBOS", registrationRaw: "N1001X", typeCodeRaw: "B738" }).row;
    const b = saveSighting(store, ref, { seenOn: "2025-06-01", airportRaw: "KBOS", registrationRaw: "N1002X", typeCodeRaw: "B738" }).row;
    const into = store.get("sightings", a.id)!.airframeId!;
    const from = store.get("sightings", b.id)!.airframeId!;
    expect(into).not.toBe(from);

    updateAirframe(store, ref, into, { msn: "30001" }, { now: NOW });
    expect(store.get("airframes", into)).toMatchObject({ provisional: false, msn: "30001", identityKey: "msn:boeing:30001" });
    expect(store.all("field_provenance").filter((p) => p.ownerId === into).map((p) => [p.field, p.source])).toEqual([["msn", "user"]]);

    mergeAirframes(store, ref, into, from);
    expect(store.get("sightings", b.id)!.airframeId).toBe(into);
    expect(store.get("airframes", from)).toBeNull();
    expect(store.all("registration_periods").filter((p) => p.airframeId === into).map((p) => p.registration).sort()).toEqual(["N1001X", "N1002X"]);
  });

  it("applies a suggested fix, and says what a fix for a named operator did", () => {
    const ref = new RefIndex(refTables);
    const store = newStore();
    const s = saveSighting(store, ref, { seenOn: "2026-05-01", airportRaw: "KBOS", registrationRaw: "N1001X", typeCodeRaw: "B73X", modelRaw: "B737-8H4" }).row;
    const fix = checkAll(store, ref, { today: "2026-10-01" }).find((f) => f.ruleId === "V-TYPE-KNOWN")!.fixes[0]!;
    expect(applyFix(store, ref, fix).message).toBeNull();
    expect(store.get("sightings", s.id)).toMatchObject({ typeCode: "B738", typeCodeRaw: "B738" });

    // A name typed where the index had no such operator yet (another device added it, or none did).
    store.insert("sightings", { seenOn: "2026-05-02", operatorRaw: "Example Motors", registration: "G-ABCE" });
    const named = checkAll(store, ref, { today: "2026-10-01" }).find((f) => f.ruleId === "V-OPERATOR-KNOWN")!.fixes[0]!;
    expect(applyFix(store, ref, named).message).toBe("Added Example Motors as an operator and linked 1 entry to it.");
  });

  it("accepts a finding and reopens it", () => {
    const ref = new RefIndex(refTables);
    const store = newStore();
    saveSighting(store, ref, { seenOn: "2026-05-01", airportRaw: "KBOS", registrationRaw: "N1001X", operatorRaw: "QQQ" });
    const f = checkAll(store, ref, { today: "2026-10-01" }).find((x) => x.ruleId === "V-OPERATOR-KNOWN")!;
    const ackId = acceptFinding(store, f, "a charter");
    expect(store.get("issue_acks", ackId)).toMatchObject({ ruleId: f.ruleId, fingerprint: f.fingerprint, note: "a charter" });
    expect(store.all("issue_ack_records").map((r) => r.recordId)).toEqual(f.records.map((r) => r.id));
    reopenFinding(store, ackId);
    expect(store.all("issue_acks")).toEqual([]);
    expect(store.all("issue_ack_records")).toEqual([]);
  });

  it("keeps one family choice per type, and the settings with their defaults", () => {
    const store = newStore();
    setFamily(store, "E75L", "A320");
    setFamily(store, "E75L", "B737");
    expect(store.all("family_overrides").map((o) => [o.designator, o.familyId])).toEqual([["E75L", "B737"]]);
    setFamily(store, "E75L", null);
    expect(store.all("family_overrides")).toEqual([]);

    expect(settingsOf(store)).toMatchObject({ codeDisplay: "iata", distanceUnit: "km", rev: 0 });
    updateSettings(store, { codeDisplay: "icao" });
    updateSettings(store, { distanceUnit: "nm" });
    expect(settingsOf(store)).toMatchObject({ codeDisplay: "icao", distanceUnit: "nm" });
  });
});
