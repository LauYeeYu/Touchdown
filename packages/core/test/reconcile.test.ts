import { describe, expect, it } from "vitest";
import {
  attachTrack,
  commitImport,
  conflictMatters,
  conflictsToShow,
  deleteRecord,
  matchCandidates,
  openConflicts,
  parseSource,
  reconcile,
  RefIndex,
  reopenFinding,
  resolveConflict,
  rowKey,
  saveFlight,
  saveSighting,
  Store,
  TABLES,
  updateAirframe,
  type TableName,
} from "../src/index.ts";
import { refTables } from "./fixtures.ts";

// Every registration, flight number, date and name here is made up.
const NOW = Date.UTC(2026, 9, 25, 12);

/** Two devices' stores, and the log as sync brings them together on a third. */
function twoDevices() {
  let t = Date.UTC(2026, 0, 1);
  const now = () => (t += 1000);
  const a = new Store({ deviceId: "dev_a", now });
  const b = new Store({ deviceId: "dev_b", now });
  // As sync leaves them: of two versions of one row, the later (here, the one with more edits).
  const together = () => {
    const c = new Store({ deviceId: "dev_c", now });
    for (const s of [a, b]) {
      for (const table of Object.keys(TABLES) as TableName[]) {
        for (const r of s.allWithDeleted(table)) {
          const cur = c.peek(table, rowKey(table, r as never)) as { rev?: number } | null;
          if (!cur || Number((r as { rev?: number }).rev) > Number(cur.rev)) c.load(table, [r as never]);
        }
      }
    }
    return c;
  };
  return { a, b, together };
}

/** Rows written by a call, counted by the store's listeners. */
function writes(store: Store, fn: () => void): number {
  let n = 0;
  const stop = store.subscribe((changes) => (n += changes.length));
  fn();
  stop();
  return n;
}

const ref = () => new RefIndex(refTables);

describe("settling what two devices made side by side", () => {
  it("makes one aircraft of the two made for a new registration, and changes nothing more when run again", () => {
    const { a, b, together } = twoDevices();
    const f = saveFlight(a, ref(), { scheduledDate: "2026-03-14", flightNumber: "DL1", airlineRaw: "DL", fromRaw: "BOS", toRaw: "SEA", registrationRaw: "N901ZZ" }).row;
    const g = saveFlight(b, ref(), { scheduledDate: "2026-03-20", flightNumber: "DL2", airlineRaw: "DL", fromRaw: "SEA", toRaw: "BOS", registrationRaw: "N901ZZ" }).row;
    const log = together();
    expect(log.all("airframes")).toHaveLength(2);

    const r = ref();
    reconcile(log, r, NOW);
    const [one] = log.all("airframes");
    expect(log.all("airframes")).toHaveLength(1);
    expect(one!.id).toBe([f.airframeId, g.airframeId].sort()[0]);
    expect(log.get("flights", f.id)?.airframeId).toBe(one!.id);
    expect(log.get("flights", g.id)?.airframeId).toBe(one!.id);
    expect(log.all("registration_periods")).toHaveLength(1);
    expect(writes(log, () => reconcile(log, r, NOW))).toBe(0);
  });

  it("merges two aircraft with one serial number, and lists a fact the user set differently on each", () => {
    const { a, b, together } = twoDevices();
    const f = saveFlight(a, ref(), { scheduledDate: "2026-03-14", flightNumber: "DL1", airlineRaw: "DL", fromRaw: "BOS", toRaw: "SEA", registrationRaw: "N902ZZ" }).row;
    updateAirframe(a, ref(), f.airframeId!, { manufacturer: "Airbus", msn: "9001", model: "A321-271NX" });
    const g = saveFlight(b, ref(), { scheduledDate: "2026-05-01", flightNumber: "DL2", airlineRaw: "DL", fromRaw: "SEA", toRaw: "BOS", registrationRaw: "N903ZZ" }).row;
    updateAirframe(b, ref(), g.airframeId!, { manufacturer: "Airbus", msn: "9001", model: "A321-272NX", notes: "Seen at the gate" });
    const log = together();

    reconcile(log, ref(), NOW);
    const [one] = log.all("airframes");
    expect(log.all("airframes")).toHaveLength(1);
    expect(one).toMatchObject({ msn: "9001", notes: "Seen at the gate" });
    expect([log.get("flights", f.id)?.airframeId, log.get("flights", g.id)?.airframeId]).toEqual([one!.id, one!.id]);
    expect(openConflicts(log).map((c) => [c.tableName, c.field])).toEqual([["airframes", "model"]]);
  });

  it("makes one of the user's own operator added on both, and points every record at it", () => {
    const { a, b, together } = twoDevices();
    const f = saveFlight(a, ref(), { scheduledDate: "2026-03-14", flightNumber: "HY1", airlineRaw: "Hyundai", fromRaw: "BOS", toRaw: "SEA" }).row;
    const g = saveFlight(b, ref(), { scheduledDate: "2026-03-15", flightNumber: "HY2", airlineRaw: "hyundai ", fromRaw: "SEA", toRaw: "BOS" }).row;
    const log = together();
    expect(log.all("operator_overrides")).toHaveLength(2);

    reconcile(log, ref(), NOW);
    const [op] = log.all("operator_overrides");
    expect(log.all("operator_overrides")).toHaveLength(1);
    expect([log.get("flights", f.id)?.airlineId, log.get("flights", g.id)?.airlineId]).toEqual([op!.id, op!.id]);
    expect(openConflicts(log)).toEqual([]);
  });

  it("keeps the later family choice for a type and lists the other", () => {
    const { a, b, together } = twoDevices();
    a.insert("family_overrides", { designator: "A21N", familyId: "fam_a320" });
    b.insert("family_overrides", { designator: "A21N", familyId: "fam_a321" });
    const log = together();

    reconcile(log, ref(), NOW);
    expect(log.all("family_overrides")).toMatchObject([{ familyId: "fam_a321" }]);
    expect(openConflicts(log)).toMatchObject([{ tableName: "family_overrides", field: "familyId", keptValue: '"fam_a321"', otherValue: '"fam_a320"' }]);
  });

  it("keeps one acceptance of a finding accepted on both, and reopening it reopens every one", () => {
    const { a, b, together } = twoDevices();
    a.insert("issue_acks", { ruleId: "C-DUP-FLIGHT", fingerprint: "abc", note: "Two legs" });
    b.insert("issue_acks", { ruleId: "C-DUP-FLIGHT", fingerprint: "abc", note: "Right" });
    const before = together();
    reopenFinding(before, before.all("issue_acks")[0]!.id);
    expect(before.all("issue_acks")).toEqual([]);

    const log = together();
    reconcile(log, ref(), NOW);
    expect(log.all("issue_acks")).toMatchObject([{ note: "Two legs · Right" }]);
  });

  it("removes a tag added twice and numbers a saved view's name taken twice", () => {
    const { a, b, together } = twoDevices();
    const s = saveSighting(a, ref(), { seenOn: "2026-04-02", airportRaw: "BOS", registrationRaw: "N904ZZ" }).row;
    const log0 = together();
    for (const t of Object.keys(TABLES) as TableName[]) for (const r of log0.allWithDeleted(t)) b.load(t, [r as never]);
    a.insert("sighting_tags", { sightingId: s.id, tag: "night" });
    b.insert("sighting_tags", { sightingId: s.id, tag: "night" });
    a.insert("saved_views", { name: "By year", dataset: "flights", rowDimension: "year", measure: "records" });
    b.insert("saved_views", { name: "by year ", dataset: "sightings", rowDimension: "year", measure: "records" });
    const log = together();

    reconcile(log, ref(), NOW);
    expect(log.all("sighting_tags")).toHaveLength(1);
    expect(log.all("saved_views").map((v) => v.name).sort()).toEqual(["By year", "by year (2)"]);
  });

  it("keeps the better of two tracks attached to one flight, with its points only", () => {
    const { a, b, together } = twoDevices();
    const f = saveFlight(a, ref(), { scheduledDate: "2026-03-14", flightNumber: "DL1", airlineRaw: "DL", fromRaw: "BOS", toRaw: "SEA" }).row;
    for (const t of Object.keys(TABLES) as TableName[]) for (const r of a.allWithDeleted(t)) b.load(t, [r as never]);
    const points = (n: number) => Array.from({ length: n }, (_, i) => ({ t: 1773500000 + i * 600, lat: 42 + i * 0.3, lon: -71 - i * 2, altitudeFt: 30000, groundSpeedKt: 450, headingDeg: 280 }));
    attachTrack(a, f.id, points(4), { provider: "adsblol", attribution: "test", coverage: "partial" });
    const kept = attachTrack(b, f.id, points(6), { provider: "fr24_csv", attribution: "test", coverage: "complete" });
    const log = together();
    for (const s of [a, b]) log.putRaw("track_points", s.all("track_points") as never);

    reconcile(log, ref(), NOW);
    expect(log.all("tracks").map((t) => t.id)).toEqual([kept]);
    expect(new Set(log.all("track_points").map((p) => p.trackId))).toEqual(new Set([kept]));
  });

  it("removes the second copy of a file imported on both devices, moving its tags", () => {
    const { a, b, together } = twoDevices();
    const sheet = { name: "Sheet1", header: ["Date", "Registration", "Airport"], rows: [["2026-04-02", "N905ZZ", "BOS"], ["2026-04-02", "N906ZZ", "BOS"]], firstRow: 2 };
    for (const s of [a, b]) {
      const r = ref();
      const source = parseSource(sheet as never, "spotting.csv", r)!;
      commitImport(s, r, source, matchCandidates(s, source.candidates));
    }
    const late = b.all("sightings")[0]!;
    b.insert("sighting_tags", { sightingId: late.id, tag: "backlit" });
    const log = together();
    expect(log.all("sightings")).toHaveLength(4);

    const out = reconcile(log, ref(), NOW);
    expect(log.all("sightings")).toHaveLength(2);
    expect(out.report.merged).toBeGreaterThanOrEqual(2);
    expect(log.all("sighting_tags")).toMatchObject([{ tag: "backlit" }]);
    expect(log.get("sightings", log.all("sighting_tags")[0]!.sightingId)).not.toBeNull();
  });

  it("keeps a sighting deleted on one device and tagged on the other, lists the deletion once, and deletes it for good when asked", () => {
    const { a, b, together } = twoDevices();
    const s = saveSighting(a, ref(), { seenOn: "2026-04-02", airportRaw: "BOS", registrationRaw: "N907ZZ" }).row;
    for (const t of Object.keys(TABLES) as TableName[]) for (const r of a.allWithDeleted(t)) b.load(t, [r as never]);
    a.remove("sightings", s.id);
    b.insert("sighting_tags", { sightingId: s.id, tag: "night" });
    b.insert("sighting_tags", { sightingId: s.id, tag: "blurry" });
    const log = together();

    const r = ref();
    expect(reconcile(log, r, NOW).report.restored).toBe(1);
    expect(log.get("sightings", s.id)).not.toBeNull();
    const listed = openConflicts(log);
    expect(listed).toMatchObject([{ tableName: "sightings", recordId: s.id, field: "deleted" }]);

    resolveConflict(log, r, listed[0]!.id, "other", { now: NOW });
    expect(log.get("sightings", s.id)).toBeNull();
    expect(log.all("sighting_tags")).toEqual([]);
    reconcile(log, r, NOW);
    expect(log.get("sightings", s.id)).toBeNull();
  });

  it("links a record set by hand to an aircraft deleted elsewhere again from its registration", () => {
    const { a, together } = twoDevices();
    const f = saveFlight(a, ref(), { scheduledDate: "2026-03-14", flightNumber: "DL1", airlineRaw: "DL", fromRaw: "BOS", toRaw: "SEA", registrationRaw: "N908ZZ" }).row;
    const gone = f.airframeId!;
    a.insert("field_provenance", { ownerTable: "flights", ownerId: f.id, field: "airframeId", source: "user" });
    for (const p of a.all("registration_periods")) a.remove("registration_periods", p.id);
    a.remove("airframes", gone);
    const log = together();

    reconcile(log, ref(), NOW);
    const now = log.get("flights", f.id)!.airframeId;
    expect(now).not.toBe(gone);
    expect(log.get("airframes", now)).not.toBeNull();
  });
});

describe("leftovers and settled conflicts", () => {
  it("leaves a tag from before a deletion alone, and deleting an entry removes its photo links", () => {
    const { a, together } = twoDevices();
    const s = saveSighting(a, ref(), { seenOn: "2026-04-02", airportRaw: "BOS", registrationRaw: "N912ZZ" }).row;
    a.insert("photo_links", { ownerTable: "sightings", ownerId: s.id, url: "https://photos.example.org/1" });
    const tag = a.insert("sighting_tags", { sightingId: s.id, tag: "night" });
    // An older version of the app deleted sightings without their tags.
    a.remove("sightings", s.id);
    const log = together();
    expect(reconcile(log, ref(), NOW).report.restored).toBe(0);
    expect(log.get("sightings", s.id)).toBeNull();
    expect(log.get("sighting_tags", tag.id)).not.toBeNull();

    const t = saveSighting(log, ref(), { seenOn: "2026-04-03", airportRaw: "BOS", registrationRaw: "N913ZZ" }).row;
    log.insert("photo_links", { ownerTable: "sightings", ownerId: t.id, url: "https://photos.example.org/2" });
    deleteRecord(log, ref(), "sightings", t.id);
    expect(log.all("photo_links").filter((p) => p.ownerId === t.id)).toEqual([]);
  });

  it("closes a conflict once the entry has the other value, and one about a value the app works out again", () => {
    const { a } = twoDevices();
    const f = saveFlight(a, ref(), { scheduledDate: "2026-03-14", flightNumber: "DL1", airlineRaw: "DL", fromRaw: "BOS", toRaw: "SEA", seat: "14C", registrationRaw: "N914ZZ" }).row;
    const base = { tableName: "flights", recordId: f.id, keptBy: "dev_a", otherBy: "dev_b", detectedAt: "2026-10-25T12:00:00Z" };
    const seat = a.insert("sync_conflicts", { ...base, field: "seat", keptValue: '"14C"', otherValue: '"12A"' });
    const link = a.insert("sync_conflicts", { ...base, field: "airframeId", keptValue: JSON.stringify(f.airframeId), otherValue: '"01NOTANAIRFRAME00000000000"' });
    const r = ref();
    reconcile(a, r, NOW);
    expect(openConflicts(a).map((c) => c.id)).toEqual([seat.id]);
    expect(a.get("sync_conflicts", link.id)?.resolution).toBe("kept");

    a.update("flights", f.id, { seat: "12A" });
    reconcile(a, r, NOW);
    expect(a.get("sync_conflicts", seat.id)?.resolution).toBe("other");
    expect(openConflicts(a)).toEqual([]);
  });
});

describe("what sync lists", () => {
  it("lists what the user could have set, not what the app works out again", () => {
    const { a } = twoDevices();
    const f = saveFlight(a, ref(), { scheduledDate: "2026-03-14", flightNumber: "DL1", airlineRaw: "DL", fromRaw: "BOS", toRaw: "SEA", registrationRaw: "N909ZZ" }).row;
    expect(conflictMatters(a, "flights", f.id, "seat")).toBe(true);
    expect(conflictMatters(a, "flights", f.id, "airframeId")).toBe(false);
    expect(conflictMatters(a, "flights", f.id, "sourceBatchId")).toBe(false);
    expect(conflictMatters(a, "airframes", f.airframeId!, "typeCode")).toBe(false);
    updateAirframe(a, ref(), f.airframeId!, { typeCode: "A21N" });
    expect(conflictMatters(a, "airframes", f.airframeId!, "typeCode")).toBe(true);
    expect(conflictMatters(a, "settings", "settings", "storageLocation")).toBe(false);
    expect(conflictMatters(a, "settings", "settings", "theme")).toBe(true);
    expect(conflictMatters(a, "registration_periods", "x", "validFrom")).toBe(false);
  });

  it("settles a registration as typed together with its normalised form", () => {
    const { a } = twoDevices();
    const f = saveFlight(a, ref(), { scheduledDate: "2026-03-14", flightNumber: "DL1", airlineRaw: "DL", fromRaw: "BOS", toRaw: "SEA", registrationRaw: "N910ZZ" }).row;
    const base = { tableName: "flights", recordId: f.id, keptBy: "dev_a", otherBy: "dev_b", detectedAt: "2026-10-25T12:00:00Z" };
    const reg = a.insert("sync_conflicts", { ...base, field: "registration", keptValue: '"N910ZZ"', otherValue: '"N911ZZ"' });
    a.insert("sync_conflicts", { ...base, field: "registrationRaw", keptValue: '"N910ZZ"', otherValue: '"n911zz"' });

    expect(conflictsToShow(a).map((c) => c.field)).toEqual(["registration"]);
    resolveConflict(a, ref(), reg.id, "other", { now: NOW });
    expect(a.get("flights", f.id)).toMatchObject({ registration: "N911ZZ", registrationRaw: "n911zz" });
    expect(openConflicts(a)).toEqual([]);
  });
});
