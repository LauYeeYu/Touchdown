// A flight's private data in its own table (docs/32-modes-and-sharing.md, "Private data"): every way a ticket number
// arrives leaves the flight's own columns empty, and opening an older log moves what is still there.

import { describe, expect, it } from "vitest";
import {
  applyChanges,
  commitImport,
  deleteRecord,
  flightEdit,
  matchCandidates,
  parseSource,
  privateOf,
  readCsv,
  saveFlight,
  settlePrivate,
  undoImport,
  type Store,
} from "../src/index.ts";
import { newStore, ref } from "./fixtures.ts";

// Made-up ticket numbers and booking references.
const T1 = "0009990000001/1";
const T2 = "0009990000002/1";

const versions = (store: Store) => JSON.stringify(["flights", "flight_private"].map((t) => store.allWithDeleted(t as "flights").map((r) => r.rev)));

describe("a flight's private data", () => {
  it("goes to the private row when a flight is saved, stays through other edits, and is cleared with null", () => {
    const store = newStore();
    const { row } = saveFlight(store, ref, { scheduledDate: "2026-03-14", flightNumber: "XY901", fromRaw: "LHR", toRaw: "JFK", ticketNumber: T1, bookingRef: "ZZ9ABC" });
    expect(store.get("flights", row.id)).toMatchObject({ ticketNumber: null, bookingRef: null });
    expect(store.get("flight_private", row.id)).toMatchObject({ flightId: row.id, ticketNumber: T1, bookingRef: "ZZ9ABC" });

    saveFlight(store, ref, { seat: "12A" }, row.id);
    expect(privateOf(store, row.id)).toEqual({ ticketNumber: T1, bookingRef: "ZZ9ABC" });

    saveFlight(store, ref, { ticketNumber: null }, row.id);
    expect(privateOf(store, row.id)).toEqual({ ticketNumber: null, bookingRef: "ZZ9ABC" });
    expect(store.get("flights", row.id)).toMatchObject({ ticketNumber: null, bookingRef: null });
  });

  it("goes with the flight when it is deleted", () => {
    const store = newStore();
    const { row } = saveFlight(store, ref, { flightNumber: "XY902", ticketNumber: T1 });
    deleteRecord(store, ref, "flights", row.id);
    expect(store.get("flight_private", row.id)).toBeNull();
  });

  it("goes to the private row on import, and the same file again is identical", () => {
    const store = newStore();
    const csv = `Date,Flight,From,To,Ticket,Booking reference\n2026-03-14,XY903,EGLL,KJFK,${T1},ZZ9DEF\n`;
    const source = parseSource(readCsv(csv), "flights.csv", ref)!;
    commitImport(store, ref, source, matchCandidates(store, source.candidates));
    const f = store.all("flights").find((x) => x.flightNumber === "XY903")!;
    expect(f).toMatchObject({ ticketNumber: null, bookingRef: null });
    expect(privateOf(store, f.id)).toEqual({ ticketNumber: T1, bookingRef: "ZZ9DEF" });
    const again = parseSource(readCsv(csv), "flights.csv", ref)!;
    expect(matchCandidates(store, again.candidates).map((m) => m.kind)).toEqual(["identical"]);
  });

  it("goes to the private row through a change file, which an edit of other fields leaves alone", () => {
    const store = newStore();
    const { row } = saveFlight(store, ref, { scheduledDate: "2026-03-14", flightNumber: "XY904", fromRaw: "EGLL", toRaw: "KJFK", ticketNumber: T1 });
    const set = flightEdit(store, ref, store.get("flights", row.id)!, { ticketNumber: T2 });
    if ("error" in set) throw new Error(set.error);
    applyChanges(store, ref, [set.change], () => true, { fileName: "edit-1.json" });
    expect(privateOf(store, row.id).ticketNumber).toBe(T2);
    expect(store.get("flights", row.id)!.ticketNumber).toBeNull();

    const seat = flightEdit(store, ref, store.get("flights", row.id)!, { seat: "3C" });
    if ("error" in seat) throw new Error(seat.error);
    expect(seat.change.set).toEqual({ seat: "3C" });
    applyChanges(store, ref, [seat.change], () => true, { fileName: "edit-2.json" });
    expect(privateOf(store, row.id).ticketNumber).toBe(T2);

    const cleared = flightEdit(store, ref, store.get("flights", row.id)!, { ticketNumber: null });
    if ("error" in cleared) throw new Error(cleared.error);
    expect(cleared.change.clear).toEqual(["ticketNumber"]);
    applyChanges(store, ref, [cleared.change], () => true, { fileName: "edit-3.json" });
    expect(privateOf(store, row.id).ticketNumber).toBeNull();
  });
});

describe("opening an older log", () => {
  it("moves what a flight still holds, once, and the second time changes nothing", () => {
    const store = newStore();
    const f = store.insert("flights", { flightNumber: "XY905", ticketNumber: T1, bookingRef: "ZZ9GHI" });
    settlePrivate(store);
    expect(store.get("flights", f.id)).toMatchObject({ ticketNumber: null, bookingRef: null });
    expect(store.get("flight_private", f.id)).toMatchObject({ ticketNumber: T1, bookingRef: "ZZ9GHI" });
    const before = versions(store);
    settlePrivate(store);
    expect(versions(store)).toBe(before);
  });

  it("never lets an older value on the flight replace a newer one in the private row", () => {
    let t = Date.UTC(2026, 0, 1);
    const store = newStore();
    (store as unknown as { now: () => number }).now = () => t;
    const f = store.insert("flights", { flightNumber: "XY906", ticketNumber: T1 });
    t += 60_000;
    store.insert("flight_private", { flightId: f.id, ticketNumber: T2 }, f.id);
    settlePrivate(store);
    expect(privateOf(store, f.id).ticketNumber).toBe(T2);
    expect(store.get("flights", f.id)!.ticketNumber).toBeNull();
  });

  it("lets a deleted flight's private row go, and keeps one whose flight is not here", () => {
    const store = newStore();
    const gone = store.insert("flights", { flightNumber: "XY907", ticketNumber: T1 });
    store.remove("flights", gone.id);
    store.insert("flight_private", { flightId: "01JZZZZZZZZZZZZZZZZZZZZZZZ", ticketNumber: T2 }, "01JZZZZZZZZZZZZZZZZZZZZZZZ");
    settlePrivate(store);
    expect(store.peek("flights", gone.id)).toMatchObject({ deleted: true, ticketNumber: null });
    expect(store.peek("flight_private", gone.id)).toMatchObject({ deleted: true });
    expect(store.get("flight_private", "01JZZZZZZZZZZZZZZZZZZZZZZZ")).toMatchObject({ ticketNumber: T2 });
  });

  it("moves a value an undone import put back on the flight", () => {
    const store = newStore();
    const csv = `Date,Flight,From,To,Seat\n2026-03-14,XY908,EGLL,KJFK,12A\n`;
    const { row } = saveFlight(store, ref, { scheduledDate: "2026-03-14", flightNumber: "XY908", fromRaw: "EGLL", toRaw: "KJFK" });
    // A version from before private data had its own table, kept by an import for undo.
    store.update("flights", row.id, { ticketNumber: T1 } as never);
    const keptRow = store.get("flights", row.id)!;
    settlePrivate(store);
    const source = parseSource(readCsv(csv), "seat.csv", ref)!;
    const r = commitImport(store, ref, source, matchCandidates(store, source.candidates));
    const h = store.all("record_history").find((x) => x.batchId === r.batchId && x.recordId === row.id)!;
    store.update("record_history", h.id, { row: keptRow as unknown as Record<string, unknown> });
    undoImport(store, ref, r.batchId);
    expect(store.get("flights", row.id)).toMatchObject({ seat: null, ticketNumber: null });
    expect(privateOf(store, row.id).ticketNumber).toBe(T1);
  });
});
