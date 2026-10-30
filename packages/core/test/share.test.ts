// What a share link shows (docs/32-modes-and-sharing.md, "Reading the log live"): only the link's records and the rows
// they point to, never a private value, a deleted entry, a sync column or import bookkeeping, whatever the log holds.

import { describe, expect, it } from "vitest";
import { isPrivateTable, mergeAirframes, saveFlight, saveSighting, SHARE_KINDS, SHARE_TABLES, shareContent, shareTracks, TABLES, updateSettings, type ShareTables, type Store, type TableName } from "../src/index.ts";
import { newStore, ref } from "./fixtures.ts";

// Made-up private values: none may appear in any link's content.
const SECRETS = ["0009990000301/1", "0009990000302/1", "ZZ9PNR", "ZZ8PNR"];

/** Every table of the log as stored, deleted rows and private tables included, as a careless reader would hand them. */
const everything = (store: Store): ShareTables => Object.fromEntries((Object.keys(TABLES) as TableName[]).map((t) => [t, store.allWithDeleted(t) as never]));

function log() {
  const store = newStore();
  const shared = saveFlight(store, ref, { scheduledDate: "2026-03-14", flightNumber: "XY301", fromRaw: "EGLL", toRaw: "KJFK", registrationRaw: "G-ZZSA", typeCode: "A359", notes: "Window seat, great view", ticketNumber: SECRETS[0], bookingRef: SECRETS[2] }).row;
  const other = saveFlight(store, ref, { scheduledDate: "2026-04-02", flightNumber: "XY302", fromRaw: "KJFK", toRaw: "EGLL", registrationRaw: "G-ZZSA", typeCode: "A359", ticketNumber: SECRETS[1], bookingRef: SECRETS[3] }).row;
  // A flight that still holds its values on its way in (an older log), and a deleted one.
  store.insert("flights", { flightNumber: "XY303", ticketNumber: SECRETS[1], registrationRaw: "G-ZZSB" });
  const gone = saveFlight(store, ref, { flightNumber: "XY304", registrationRaw: "G-ZZSA" }).row;
  store.remove("flights", gone.id);
  const sighting = saveSighting(store, ref, { seenOn: "2026-05-01", airportRaw: "EGLL", registrationRaw: "G-ZZSA", typeCode: "A359", phase: "landing" }, undefined, ["partial_body"]).row;
  store.insert("photo_links", { ownerTable: "flights", ownerId: shared.id, url: "https://example.org/album", label: "Album" });
  store.insert("tracks", { flightId: shared.id, provider: "fr24_csv" });
  store.insert("sync_conflicts", { tableName: "flight_private", recordId: shared.id, field: "ticketNumber", keptValue: JSON.stringify(SECRETS[0]), otherValue: JSON.stringify(SECRETS[1]) });
  return { store, shared, other, gone, sighting };
}

describe("a share link's content", () => {
  it("reads no private table, for any kind", () => {
    for (const kind of SHARE_KINDS) for (const t of SHARE_TABLES[kind]) expect(isPrivateTable(t), `${kind}: ${t}`).toBe(false);
  });

  it("holds no private value, deleted entry, sync column or bookkeeping, for any kind", () => {
    const { store, shared, sighting } = log();
    const airframe = store.get("flights", shared.id)!.airframeId!;
    for (const [kind, subject] of [["flight", shared.id], ["sighting", sighting.id], ["aircraft", airframe], ["log", null]] as const) {
      const text = JSON.stringify(shareContent(kind, subject, null, everything(store)));
      for (const s of SECRETS) expect(text, kind).not.toContain(s);
      for (const col of ["ticketNumber", "bookingRef", "rev", "updatedAt", "updatedBy", "versionVector", "basedOn", "deleted", "sourceBatchId", "sourceKind"]) expect(text, `${kind}: ${col}`).not.toContain(`"${col}"`);
      expect(text, kind).not.toContain("XY304");
      expect(text, kind).not.toContain("record_history");
    }
  });

  it("shows one flight with its aircraft, track and photo links, and not the other flights on that aircraft", () => {
    const { store, shared } = log();
    const c = shareContent("flight", shared.id, null, everything(store));
    expect(c).toMatchObject({ kind: "flight", subject: shared.id, gone: false });
    expect(c.tables.flights).toEqual([expect.objectContaining({ id: shared.id, flightNumber: "XY301", notes: "Window seat, great view" })]);
    expect(c.tables.airframes).toHaveLength(1);
    expect(c.tables.tracks).toHaveLength(1);
    expect(c.tables.photo_links).toEqual([expect.objectContaining({ url: "https://example.org/album" })]);
    expect(c.tables.sightings).toBeUndefined();
  });

  it("shows a sighting with its statuses and tags", () => {
    const { store, sighting } = log();
    const c = shareContent("sighting", sighting.id, null, everything(store));
    expect(c.tables.sightings).toHaveLength(1);
    expect(c.tables.sighting_phases).toEqual([expect.objectContaining({ phase: "landing" })]);
    expect(c.tables.sighting_tags).toEqual([expect.objectContaining({ tag: "partial_body" })]);
    expect(c.tables.flights).toBeUndefined();
  });

  it("shows an aircraft with the user's flights and sightings of it, and follows it through a merge", () => {
    const { store, shared, other, sighting } = log();
    const a = store.get("flights", shared.id)!.airframeId!;
    const c = shareContent("aircraft", a, `flights/${shared.id}`, everything(store));
    expect(c.tables.flights!.map((f) => f.flightNumber).sort()).toEqual(["XY301", "XY302"]);
    expect(c.tables.sightings!.map((s) => s.id)).toEqual([sighting.id]);
    expect(c.tables.registration_periods!.length).toBeGreaterThan(0);

    // The aircraft is merged into another: the link follows its anchor flight there.
    const into = store.insert("airframes", { identityKey: "msn:airbus-a350:999", msn: "999", typeCode: "A359", provisional: false }).id;
    mergeAirframes(store, ref, into, a);
    const after = shareContent("aircraft", a, `flights/${shared.id}`, everything(store));
    expect(after).toMatchObject({ subject: into, gone: false });
    expect(after.tables.flights!.map((f) => f.id).sort()).toEqual([shared.id, other.id].sort());
  });

  it("says a deleted or unknown record is gone, and shows nothing", () => {
    const { store, gone } = log();
    expect(shareContent("flight", gone.id, null, everything(store))).toMatchObject({ gone: true, tables: {} });
    expect(shareContent("aircraft", "01JUNKNOWN0000000000000000", null, everything(store))).toMatchObject({ gone: true, tables: {} });
  });

  it("shows the whole log's live records", () => {
    const { store } = log();
    const c = shareContent("log", null, null, everything(store));
    expect(c.tables.flights!.map((f) => f.flightNumber).sort()).toEqual(["XY301", "XY302", "XY303"]);
    expect(c.tables.sightings).toHaveLength(1);
  });

  it("gives a track only for a flight the link shows", () => {
    const { store, shared, other, sighting } = log();
    const t = everything(store);
    const track = store.all("tracks")[0]!.id;
    const airframe = store.get("flights", shared.id)!.airframeId!;
    expect([...shareTracks(shareContent("flight", shared.id, null, t))]).toEqual([[shared.id, track]]);
    expect([...shareTracks(shareContent("flight", other.id, null, t))]).toEqual([]);
    expect([...shareTracks(shareContent("log", null, null, t))]).toEqual([[shared.id, track]]);
    expect([...shareTracks(shareContent("aircraft", airframe, null, t))]).toEqual([[shared.id, track]]);
    expect([...shareTracks(shareContent("sighting", sighting.id, null, t))]).toEqual([]);
  });

  it("keeps the owner's display choices and nothing else of the settings", () => {
    const { store, shared } = log();
    updateSettings(store, { distanceUnit: "mi", codeDisplay: "icao", storageAccount: "owner@example.org", storageLocation: "ZZfolder", homeAirportId: "ap_egll" });
    for (const [kind, subject] of [["flight", shared.id], ["log", null]] as const) {
      const c = shareContent(kind, subject, null, everything(store));
      expect(c.tables.settings).toEqual([expect.objectContaining({ distanceUnit: "mi", codeDisplay: "icao" })]);
      const text = JSON.stringify(c.tables.settings);
      for (const leak of ["owner@example.org", "ZZfolder", "ap_egll", "storage", "homeAirport", "dataMode"]) expect(text, kind).not.toContain(leak);
    }
  });
});
